import { randomUUID } from "node:crypto";
import {
  claimNextExecution, extendLease, finishExecution, isCancelRequested, holdsLease, scheduleRetry,
  type Database, type ExecutionRecord,
} from "@exhibit/database";
import type { ModelClient } from "../ai/types.js";
import { routingVersion, type RoutingTable } from "../ai/routing.js";
import { failTurn } from "../agent/persist.js";
import { failComment } from "@exhibit/database";
import { ModelError } from "../ai/types.js";
import type { RunContext } from "./context.js";
import { ContextLimitError, CanvasError } from "../permissions/types.js";
import { BudgetError, CancelledError, ContextChangedError, LeaseLostError, ValidationFailure, isTransientDbError } from "./errors.js";
import { DEFAULT_LIMITS, ModelCaller } from "./modelCaller.js";
import { ExecutionRecorder } from "./recorder.js";

export type Handler = (ctx: RunContext, execution: ExecutionRecord) => Promise<void>;

export interface WorkerOptions {
  /** Direct (non-pooled) connection: leases and locks should not depend on pooler session behavior. */
  db: Database;
  models: ModelClient;
  routing: RoutingTable;
  handlers: Partial<Record<ExecutionRecord["kind"], Handler>>;
  backendCommit: string | null;
  payloadMaxBytes: number;
  runTimeoutMs: number;
  leaseMs?: number;
  pollMs?: number;
  /** Delay before re-running after a transient infrastructure failure. */
  retryDelayMs?: number;
  log?: (message: string, data?: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** What the user sees when a run fails. Always honest; never presented as a finished result. */
export function failureMessage(error: unknown): { code: string; message: string } {
  if (error instanceof ValidationFailure) {
    return { code: "validation_failed", message: "The AI's answer did not pass the evidence checks, so nothing was saved. Your existing work is unchanged. You can try again or rephrase." };
  }
  if (error instanceof ContextChangedError) {
    return { code: "context_changed", message: "Sharing settings or canvas content changed while this ran, so nothing was saved. Run it again to use the current permissions." };
  }
  if (error instanceof ContextLimitError) return { code: error.code, message: `${error.message} Shorten or remove some text on the canvas, then run it again.` };
  if (error instanceof CanvasError) return { code: error.code, message: `${error.message} Nothing was saved.` };
  if (error instanceof BudgetError) return { code: error.code, message: `${error.message} Your existing work is unchanged.` };
  if (error instanceof ModelError) {
    return { code: "model_error", message: "The AI provider failed after several attempts, so nothing was saved. Your existing work is unchanged. You can try again." };
  }
  return { code: "internal_error", message: "Something went wrong while running this request. Your existing work is unchanged. You can try again." };
}

/**
 * Leases executions from the durable queue and runs them. Process memory is never the source of truth:
 * if this process dies, another claim picks the work up after the lease expires.
 */
export class Worker {
  private stopped = true;
  private loop: Promise<void> | null = null;
  readonly owner = `worker-${randomUUID().slice(0, 8)}`;
  private readonly leaseMs: number;

  constructor(private readonly options: WorkerOptions) {
    this.leaseMs = options.leaseMs ?? 30_000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = (async () => {
      while (!this.stopped) {
        let ranOne = false;
        try {
          ranOne = await this.runOne();
        } catch (error) {
          this.options.log?.("worker tick failed", { error: (error as Error).message });
        }
        if (!ranOne && !this.stopped) await (this.options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(this.options.pollMs ?? 1000);
      }
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
  }

  /** Claim and run one execution. Returns false when the queue had nothing runnable. */
  async runOne(): Promise<boolean> {
    const { db } = this.options;
    const execution = await claimNextExecution(db, this.owner, this.leaseMs);
    if (!execution) return false;

    const handler = this.options.handlers[execution.kind];
    if (!handler) {
      await finishExecution(db, execution.id, this.owner, { status: "failed", errorCode: "no_handler", errorMessage: `No handler for ${execution.kind}.` });
      return true;
    }

    let lost = false;
    const heartbeat = setInterval(() => {
      extendLease(db, execution.id, this.owner, this.leaseMs).then((ok) => { if (!ok) lost = true; }, () => { /* retried next beat */ });
    }, Math.max(500, Math.floor(this.leaseMs / 3)));

    const recorder = new ExecutionRecorder(db, execution.id, this.options.payloadMaxBytes);
    const checkpoint = async () => {
      if (lost || !(await holdsLease(db, execution.id, this.owner))) throw new LeaseLostError();
      if (await isCancelRequested(db, execution.id)) throw new CancelledError();
    };
    const ctx: RunContext = {
      db,
      agencyId: execution.agencyId,
      executionId: execution.id,
      owner: this.owner,
      backendCommit: execution.backendCommit,
      routing: this.options.routing,
      routingVersion: routingVersion(this.options.routing),
      recorder,
      checkpoint,
      models: new ModelCaller({
        db, agencyId: execution.agencyId, client: this.options.models, routing: this.options.routing, recorder,
        limits: { ...DEFAULT_LIMITS, attemptsPerCall: DEFAULT_LIMITS.attemptsPerCall, deadlineAt: Date.now() + this.options.runTimeoutMs },
        isCancelled: async () => { await checkpoint(); return false; },
        sleep: this.options.sleep,
      }),
    };

    try {
      await recorder.event("progress", "Run started", { attempt: execution.attempt, kind: execution.kind });
      await handler(ctx, execution);
      const finished = await finishExecution(db, execution.id, this.owner, { status: "succeeded" });
      if (finished) await recorder.event("progress", "Run finished");
    } catch (error) {
      await this.handleFailure(execution, ctx, error);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  private async handleFailure(execution: ExecutionRecord, ctx: RunContext, error: unknown): Promise<void> {
    const { db } = this.options;
    if (error instanceof LeaseLostError) {
      // Another worker owns this run now; write nothing.
      this.options.log?.("lease lost", { execution: execution.id });
      return;
    }
    if (error instanceof CancelledError) {
      await ctx.recorder.event("error", "Run cancelled").catch(() => {});
      if (execution.turnId) await failTurn(db, execution.turnId, "cancelled", "This request was cancelled.");
      if (execution.commentId) await failComment(db, execution.commentId, "This request was cancelled.").catch(() => {});
      await finishExecution(db, execution.id, this.owner, { status: "cancelled" });
      return;
    }
    if (isTransientDbError(error) && execution.attempt < execution.maxAttempts) {
      await scheduleRetry(db, execution.id, this.owner, (this.options.retryDelayMs ?? 2000) * 2 ** (execution.attempt - 1), {
        code: "transient_database_error", message: (error as Error).message,
      }).catch(() => {});
      return;
    }
    const failure = failureMessage(error);
    await ctx.recorder.event("error", "Run failed", {
      code: failure.code, message: (error as Error).message,
      ...(error instanceof ValidationFailure ? { problems: error.problems } : {}),
    }).catch(() => {});
    if (execution.turnId) await failTurn(db, execution.turnId, "failed", failure.message).catch(() => {});
    if (execution.commentId) await failComment(db, execution.commentId, failure.message).catch(() => {});
    await finishExecution(db, execution.id, this.owner, { status: "failed", errorCode: failure.code, errorMessage: (error as Error).message });
  }
}
