import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimNextExecution, extendLease, finishExecution, requestCancel, scheduleRetry, type ExecutionRecord,
} from "@exhibit/database";
import { commitTurn } from "../agent/persist.js";
import { createHarness, type Harness } from "../testing/harness.js";
import { LeaseLostError } from "./errors.js";

let h: Harness;
beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});

/** Claim only this agency's work, so parallel test data never interferes. */
async function claimFor(agencyId: string, owner: string, leaseMs = 60_000): Promise<ExecutionRecord | null> {
  // Park everyone else's queued work for the duration of the claim by claiming in a loop and releasing others.
  const others: ExecutionRecord[] = [];
  try {
    for (let i = 0; i < 50; i++) {
      const claimed = await claimNextExecution(h.db, owner, leaseMs);
      if (!claimed) return null;
      if (claimed.agencyId === agencyId) return claimed;
      others.push(claimed);
    }
    return null;
  } finally {
    // Hand back anything claimed by mistake without consuming an attempt.
    for (const other of others) {
      await h.db.query("update executions set status = 'queued', attempt = attempt - 1, lease_owner = null, lease_expires_at = null where id = $1", [other.id]);
    }
  }
}

describe("the durable queue", () => {
  it("runs turns in a conversation one at a time and in order", async () => {
    const w = await h.newWorld();
    const first = await w.submit("ridgeline-outfitters", "First");
    const second = await w.submit("ridgeline-outfitters", "Second");

    const a = await claimFor(w.agencyId, "worker-a");
    expect(a?.id).toBe(first.executionId);
    // While the first is running, the second must wait, even for another worker.
    expect(await claimFor(w.agencyId, "worker-b")).toBeNull();

    expect(await finishExecution(h.db, a!.id, "worker-a", { status: "succeeded" })).toBe(true);
    await h.db.query("update turns set status = 'succeeded' where id = $1", [first.turnId]);
    const b = await claimFor(w.agencyId, "worker-b");
    expect(b?.id).toBe(second.executionId);
  });

  it("does not start a later turn while an earlier one is still queued", async () => {
    const w = await h.newWorld();
    const first = await w.submit("ridgeline-outfitters", "First");
    await w.submit("ridgeline-outfitters", "Second");
    // Delay the first so only the second would otherwise be runnable.
    await h.db.query("update executions set available_at = now() + interval '1 hour' where id = $1", [first.executionId]);
    expect(await claimFor(w.agencyId, "worker-a")).toBeNull();
  });

  it("lets conversations for different clients run independently", async () => {
    const w = await h.newWorld();
    const r = await w.submit("ridgeline-outfitters", "Ridgeline question");
    const m = await w.submit("marlowe-finch", "Marlowe question");
    const claimed = [await claimFor(w.agencyId, "worker-a"), await claimFor(w.agencyId, "worker-b")];
    expect(claimed.map((c) => c?.id).sort()).toEqual([r.executionId, m.executionId].sort());
  });

  it("recovers a run whose worker died: the lease expires and another worker takes it over", async () => {
    const w = await h.newWorld();
    const { executionId } = await w.submit("ridgeline-outfitters", "Hello");
    const dead = await claimFor(w.agencyId, "worker-dead");
    expect(dead?.attempt).toBe(1);

    // While the lease is alive nobody can take it.
    expect(await claimFor(w.agencyId, "worker-new")).toBeNull();

    await h.db.query("update executions set lease_expires_at = now() - interval '1 second' where id = $1", [executionId]);
    const recovered = await claimFor(w.agencyId, "worker-new");
    expect(recovered?.id).toBe(executionId);
    expect(recovered?.attempt).toBe(2);
    expect(recovered?.leaseOwner).toBe("worker-new");

    // The original worker is stale now: it can neither extend nor finish.
    expect(await extendLease(h.db, executionId, "worker-dead", 60_000)).toBe(false);
    expect(await finishExecution(h.db, executionId, "worker-dead", { status: "succeeded" })).toBe(false);
    expect((await h.db.query("select status, lease_owner from executions where id = $1", [executionId])).rows[0]).toEqual({ status: "running", lease_owner: "worker-new" });
  });

  it("refuses to commit results from a worker that lost its lease", async () => {
    const w = await h.newWorld();
    const { executionId, turnId, conversationId } = await w.submit("ridgeline-outfitters", "Hello");
    await claimFor(w.agencyId, "worker-a");
    const attempt = (owner: string) => commitTurn(h.db, {
      executionId, owner, turnId, conversationId, agencyId: w.agencyId, replyKind: "answer", replyMessage: "stale",
      replyData: {}, sourceFingerprint: "x",
      artifact: { action: "create", kind: "client_summary", title: "Should never exist", blocks: [] },
    });
    await expect(attempt("worker-impostor")).rejects.toBeInstanceOf(LeaseLostError);
    expect((await h.db.query("select count(*)::int n from artifacts where conversation_id = $1", [conversationId])).rows[0].n).toBe(0);
    expect((await h.db.query("select status, reply_message from turns where id = $1", [turnId])).rows[0].reply_message).toBeNull();
  });

  it("fails a run that keeps dying instead of retrying forever, and tells the user", async () => {
    const w = await h.newWorld();
    const { executionId, turnId } = await w.submit("ridgeline-outfitters", "Hello");
    await h.db.query("update executions set status = 'running', attempt = max_attempts, lease_owner = 'gone', lease_expires_at = now() - interval '1 second' where id = $1", [executionId]);
    await h.db.query("update turns set status = 'running' where id = $1", [turnId]);
    expect(await claimFor(w.agencyId, "worker-new")).toBeNull();
    const exec = (await h.db.query("select status, error_code from executions where id = $1", [executionId])).rows[0];
    expect(exec).toEqual({ status: "failed", error_code: "lease_expired" });
    const turn = (await h.db.query("select status, reply_kind, reply_message from turns where id = $1", [turnId])).rows[0];
    expect(turn.status).toBe("failed");
    expect(turn.reply_kind).toBe("failure");
  });

  it("waits out a retry delay before running again", async () => {
    const w = await h.newWorld();
    const { executionId } = await w.submit("ridgeline-outfitters", "Hello");
    const run = await claimFor(w.agencyId, "worker-a");
    expect(await scheduleRetry(h.db, run!.id, "worker-a", 60_000, { code: "transient", message: "blip" })).toBe(true);
    expect((await h.db.query("select status from executions where id = $1", [executionId])).rows[0].status).toBe("waiting_to_retry");
    expect(await claimFor(w.agencyId, "worker-b")).toBeNull();
    await h.db.query("update executions set available_at = now() - interval '1 second' where id = $1", [executionId]);
    expect((await claimFor(w.agencyId, "worker-b"))?.id).toBe(executionId);
  });

  it("cancels a queued run immediately and it never runs", async () => {
    const w = await h.newWorld();
    const { executionId, turnId } = await w.submit("ridgeline-outfitters", "Hello");
    expect(await requestCancel(h.db, w.agencyId, executionId)).toBe("cancelled");
    expect(await claimFor(w.agencyId, "worker-a")).toBeNull();
    expect((await h.db.query("select status from turns where id = $1", [turnId])).rows[0].status).toBe("cancelled");
    // A finished run cannot be cancelled again, and other visitors cannot cancel it at all.
    const other = await h.newWorld();
    expect(await requestCancel(h.db, other.agencyId, executionId)).toBeNull();
  });

  it("a cancelled run is never marked succeeded", async () => {
    const w = await h.newWorld();
    const { executionId } = await w.submit("ridgeline-outfitters", "Hello");
    const run = await claimFor(w.agencyId, "worker-a");
    expect(await requestCancel(h.db, w.agencyId, executionId)).toBe("cancelling");
    expect(await finishExecution(h.db, run!.id, "worker-a", { status: "cancelled" })).toBe(true);
    expect((await h.db.query("select status from executions where id = $1", [executionId])).rows[0].status).toBe("cancelled");
  });
});
