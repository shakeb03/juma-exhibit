import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestCancel } from "@exhibit/database";
import {
  ScriptedModel, createHarness, phase, recentToolResults, retryable, toolCall, type Harness, type Script,
} from "../testing/harness.js";

const key = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/evaluations/answer-key.json"), "utf8"),
);
const ridgeline = key.clients["ridgeline-outfitters"].byCampaign;

let h: Harness;
beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});

/** Gathering steps for "compare the latest two Pinterest campaigns", then a caller-supplied compose step. */
function latestTwoScript(compose: Script): Script {
  let gatherStep = 0;
  return (request, index, history) => {
    if (phase(request) === "compose") return compose(request, index, history);
    gatherStep++;
    switch (gatherStep) {
      case 1: return [toolCall("discover_sources")];
      case 2: return [toolCall("retrieve_campaigns", { latest: { count: 2, channel: "Pinterest" } })];
      case 3: return [
        toolCall("calculate_metrics", { label: "Summit Weekend", campaignIds: ["RL-PIN-0901"] }),
        toolCall("calculate_metrics", { label: "Fall Gear Guide", campaignIds: ["RL-PIN-0902"] }),
      ];
      case 4: return [toolCall("compare_metrics", { fromScopeId: "RL-PIN-0901", toScopeId: "RL-PIN-0902", metrics: ["ctr", "conversionsPer1kImpressions"] })];
      default: return [toolCall("ready_to_answer")];
    }
  };
}

const observation = (text: string, ids: string[]) => ({ type: "observation" as const, text, metricIds: ids, sourceRefs: [] as string[] });
const goodReply = () => ({
  message: "Here is how the two latest Pinterest campaigns compare.",
  statements: [
    observation("Summit Weekend's CTR was {{metric:RL-PIN-0901:ctr}} against {{metric:RL-PIN-0902:ctr}} for Fall Gear Guide.", ["metric:RL-PIN-0901:ctr", "metric:RL-PIN-0902:ctr"]),
    observation("Conversions per 1,000 impressions changed by {{cmp:RL-PIN-0901->RL-PIN-0902:conversionsPer1kImpressions:rel}}.", []),
    { type: "hypothesis" as const, text: "The image style may account for part of the click difference." },
    { type: "recommendation" as const, text: "Run a matched test of image styles.", reasoning: "It separates image style from audience and budget.", measurement: "Clicks per 1,000 impressions in each arm.", limitation: "The two campaigns differed in spend and audience." },
  ],
});
const finish = (reply: unknown, artifact?: unknown) => [toolCall("finish", artifact ? { reply, artifact } : { reply })];

const reportArtifact = (extra: object[] = []) => ({
  action: "create" as const, kind: "performance_report" as const, title: "Pinterest comparison",
  blocks: [
    { type: "heading", level: 1, text: "Pinterest comparison" },
    { type: "paragraph", text: "Summit Weekend reached a CTR of {{metric:RL-PIN-0901:ctr}}." },
    { type: "metric_table", caption: "Latest two Pinterest campaigns", scopes: [{ label: "Summit Weekend", scopeId: "RL-PIN-0901" }, { label: "Fall Gear Guide", scopeId: "RL-PIN-0902" }], metrics: ["ctr", "conversionRate"] },
    { type: "observation", key: "o1", text: "CTR was {{metric:RL-PIN-0901:ctr}} then {{metric:RL-PIN-0902:ctr}}.", metricIds: ["metric:RL-PIN-0901:ctr", "metric:RL-PIN-0902:ctr"], sourceRefs: [] },
    { type: "hypothesis", key: "h1", text: "Imagery may influence clicks.", basedOn: ["o1"], sourceRefs: [] },
    { type: "recommendation", key: "r1", text: "Test imagery.", reasoning: "Isolates the image.", basedOn: ["o1"], measurement: "Clicks per 1,000 impressions.", limitation: "Needs matched audiences." },
    { type: "limitation", text: "Campaigns differed in spend." },
    ...extra,
  ],
});

async function turnRow(id: string) {
  return (await h.db.query("select * from turns where id = $1", [id])).rows[0];
}
async function executionRow(id: string) {
  return (await h.db.query("select * from executions where id = $1", [id])).rows[0];
}

describe("a conversational answer", () => {
  it("gathers evidence, computes numbers in code, and answers without forcing an artifact", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish(goodReply())));
    const worker = h.worker(model);
    const { turnId, executionId, conversationId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns. Explain what changed and suggest what we should try next.");
    expect(await h.drain(worker)).toBe(1);

    const turn = await turnRow(turnId);
    expect(turn.status).toBe("succeeded");
    expect(turn.reply_kind).toBe("answer");
    expect((await executionRow(executionId)).status).toBe("succeeded");
    expect((await h.db.query("select count(*)::int n from artifacts where conversation_id = $1", [conversationId])).rows[0].n).toBe(0);

    // The browser sees verified values filled in from code, matching the independent answer key.
    const conversation = (await w.get(`/v1/clients/${w.client["ridgeline-outfitters"]}/conversation`)).json();
    const reply = conversation.turns[0].reply;
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    expect(reply.statements[0].text).toBe(`Summit Weekend's CTR was ${pct(ridgeline["RL-PIN-0901"].ctr)} against ${pct(ridgeline["RL-PIN-0902"].ctr)} for Fall Gear Guide.`);
    const a = ridgeline["RL-PIN-0901"].conversionsPer1kImpressions;
    const b = ridgeline["RL-PIN-0902"].conversionsPer1kImpressions;
    const rel = ((b - a) / a) * 100;
    expect(reply.statements[1].text).toBe(`Conversions per 1,000 impressions changed by −${Math.abs(rel).toFixed(1)}%.`);
    expect(reply.claims).toEqual({ verified: 3, total: 3 });
    // Evidence travels with the answer: formula, inputs, and rows.
    expect(reply.evidence["metric:RL-PIN-0901:ctr"].formula).toBe("clicks / impressions");
    expect(reply.evidence["metric:RL-PIN-0901:ctr"].inputs).toEqual({ clicks: 33800, impressions: 1300000 });
    expect(reply.evidence["metric:RL-PIN-0901:ctr"].rowIds).toEqual(["RL-PIN-0901"]);
    // The latest two Pinterest campaigns were chosen automatically, by end date.
    const retrieved = model.requests.flatMap((r) => recentToolResults(r)).find((t) => t.name === "retrieve_campaigns");
    expect(retrieved?.value.campaigns?.map((c) => c.campaignId)).toEqual(["RL-PIN-0902", "RL-PIN-0901"]);
  });

  it("records tool calls, checks, and every model call, with different models for different tasks", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish(goodReply())));
    const { executionId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));

    const events = (await w.get(`/v1/executions/${executionId}/events`)).json();
    expect(events.status).toBe("succeeded");
    const names = events.events.map((e: { kind: string; name: string }) => `${e.kind}:${e.name}`);
    expect(names).toContain("tool_call:discover_sources");
    expect(names).toContain("tool_call:retrieve_campaigns");
    expect(names).toContain("tool_call:calculate_metrics");
    expect(names).toContain("tool_call:compare_metrics");
    expect(names).toContain("check:Validated answer");
    const check = events.events.find((e: { name: string }) => e.name === "Validated answer");
    expect(check.payload.passed).toBe(true);
    expect(check.payload.numericalClaims).toBe("3 of 3 verified");
    // Ordered ids make cursor polling possible.
    const ids = events.events.map((e: { id: number }) => e.id);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    const later = (await w.get(`/v1/executions/${executionId}/events?after=${ids[2]}`)).json();
    expect(later.events[0].id).toBe(ids[3]);

    const calls = (await h.db.query("select task, requested_model, actual_model, input_tokens, output_tokens, duration_ms from model_calls where execution_id = $1 order by created_at", [executionId])).rows;
    expect(calls.filter((c) => c.task === "interpret")).toHaveLength(5);
    expect(calls.filter((c) => c.task === "explain")).toHaveLength(1);
    expect(new Set(calls.map((c) => c.requested_model)).size).toBeGreaterThan(1);
    expect(calls.every((c) => c.input_tokens === 400 && c.output_tokens === 120)).toBe(true);

    const exec = await executionRow(executionId);
    expect(exec.routing_version).toMatch(/^[0-9a-f]{12}$/);
    expect(exec.routing_snapshot.interpret.primary).toBeTruthy();
    expect(exec.backend_commit).toBeNull(); // submit path has no commit configured in tests
    expect(exec.input_snapshot.client.slug).toBe("ridgeline-outfitters");
    expect(Object.keys(exec.input_snapshot.contextChecksums)).toContain("brandVoice");
    const agency = (await h.db.query("select tokens_reserved, tokens_spent from agencies where id = $1", [w.agencyId])).rows[0];
    expect(Number(agency.tokens_spent)).toBe(6 * 520);
    expect(Number(agency.tokens_reserved)).toBe(0);
  });

  it("gives the model the stored brand context without the user explaining it", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish(goodReply())));
    await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    const system = model.requests[0]!.messages[0]!.content!;
    expect(system).toContain("Ridgeline Outfitters");
    expect(system).toMatch(/Plain-spoken|plain-spoken/);
    expect(system).toMatch(/Weekly reports lead with revenue and ROAS/);
    // Another client's private context never reaches this conversation.
    expect(JSON.stringify(model.requests)).not.toMatch(/Mara Voss|Elise|handwritten note/);
  });
});

describe("artifacts and revisions", () => {
  it("creates a report with stable block IDs linked to the turn, then revises it into a new version", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish(goodReply(), reportArtifact())));
    const first = await w.submit("ridgeline-outfitters", "Create a performance report comparing our last two Pinterest campaigns.");
    await h.drain(h.worker(model));

    const created = (await h.db.query(
      "select v.id, v.version, v.blocks, v.cause_kind, v.cause_turn_id, v.checks, a.kind, a.current_version_id from artifact_versions v join artifacts a on a.id = v.artifact_id where a.conversation_id = $1",
      [first.conversationId],
    )).rows;
    expect(created).toHaveLength(1);
    const v1 = created[0];
    expect(v1.version).toBe(1);
    expect(v1.cause_kind).toBe("turn");
    expect(v1.cause_turn_id).toBe(first.turnId);
    expect(v1.kind).toBe("performance_report");
    expect(v1.current_version_id).toBe(v1.id);
    expect(new Set(v1.blocks.map((b: { id: string }) => b.id)).size).toBe(7);
    expect(v1.checks.claims.verified).toBe(v1.checks.claims.total);
    const observationId = v1.blocks.find((b: { type: string }) => b.type === "observation").id;
    expect(v1.blocks.find((b: { type: string }) => b.type === "recommendation").basedOn).toEqual([observationId]);

    // The version endpoint renders verified values and keeps the evidence.
    const rendered = (await w.get(`/v1/artifact-versions/${v1.id}`)).json();
    expect(rendered.renderedBlocks[1].text).toBe(`Summit Weekend reached a CTR of ${(ridgeline["RL-PIN-0901"].ctr * 100).toFixed(2)}%.`);
    expect(rendered.metrics["metric:RL-PIN-0902:ctr"]).toBeTruthy();

    // Approve v1, then ask for a change. The follow-up needs no re-gathering and keeps existing block IDs.
    await h.db.query("insert into approvals (artifact_version_id) values ($1)", [v1.id]);
    const keep = v1.blocks.map((b: { id: string; type: string }) => ({ id: b.id, type: b.type }));
    const second = new ScriptedModel((request) => {
      if (phase(request) === "gather") return [toolCall("ready_to_answer")];
      const blocks = v1.blocks.map((b: Record<string, unknown>) =>
        b.type === "heading" ? { ...b, text: "Pinterest comparison: conversions focus" } : b);
      return finish(
        { message: "I refocused the report on conversions.", statements: [] },
        { action: "update", title: "Pinterest comparison", blocks },
      );
    });
    const followUp = await w.submit("ridgeline-outfitters", "Focus on conversions.");
    await h.drain(h.worker(second));

    const versions = (await h.db.query("select id, version, blocks, cause_turn_id, base_version_id from artifact_versions where artifact_id = (select artifact_id from artifact_versions where id = $1) order by version", [v1.id])).rows;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const v2 = versions[1];
    expect(v2.cause_turn_id).toBe(followUp.turnId);
    expect(v2.base_version_id).toBe(v1.id);
    expect(v2.blocks.map((b: { id: string }) => b.id)).toEqual(keep.map((b: { id: string }) => b.id));
    expect(v2.blocks[0].text).toBe("Pinterest comparison: conversions focus");
    // Approval belongs to v1 only.
    const approvals = (await h.db.query("select artifact_version_id from approvals")).rows.map((r) => r.artifact_version_id);
    expect(approvals).toContain(v1.id);
    expect(approvals).not.toContain(v2.id);
    // Registry values were restored from v1, so the unchanged blocks still resolve.
    expect((await w.get(`/v1/artifact-versions/${v2.id}`)).json().renderedBlocks[1].text).toMatch(/\d\.\d\d%/);
    const current = (await h.db.query("select current_version_id from artifacts where id = (select artifact_id from artifact_versions where id = $1)", [v1.id])).rows[0];
    expect(current.current_version_id).toBe(v2.id);
  });

  it("asks a focused clarification instead of guessing, and creates nothing", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel((request) => {
      if (phase(request) === "compose") throw new Error("must not compose");
      return request.messages.some((m) => m.role === "tool")
        ? [toolCall("ask_clarification", { question: "Do you mean the last two Pinterest campaigns, or the last two across all channels?", options: ["Pinterest only", "All channels"] })]
        : [toolCall("discover_sources")];
    });
    const { turnId, executionId, conversationId } = await w.submit("ridgeline-outfitters", "Compare our last two campaigns.");
    await h.drain(h.worker(model));
    const turn = await turnRow(turnId);
    expect(turn.status).toBe("succeeded");
    expect(turn.reply_kind).toBe("clarification");
    expect(turn.reply_message).toMatch(/last two Pinterest campaigns/);
    expect(turn.reply_data.options).toEqual(["Pinterest only", "All channels"]);
    expect((await executionRow(executionId)).status).toBe("succeeded");
    expect(model.requests.some((r) => r.task === "explain")).toBe(false);
    expect((await h.db.query("select count(*)::int n from artifacts where conversation_id = $1", [conversationId])).rows[0].n).toBe(0);
  });
});

describe("evidence checks", () => {
  it("repairs once when the first answer types its own number, and saves only the repaired answer", async () => {
    const w = await h.newWorld();
    let composeCalls = 0;
    const model = new ScriptedModel(latestTwoScript(() => {
      composeCalls++;
      if (composeCalls === 1) {
        const bad = goodReply();
        bad.statements[0] = observation("CTR was 2.6% for Summit Weekend.", ["metric:RL-PIN-0901:ctr"]);
        return finish(bad);
      }
      return finish(goodReply());
    }));
    const { turnId, executionId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect(composeCalls).toBe(2);
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const checks = (await w.get(`/v1/executions/${executionId}/events`)).json().events.filter((e: { name: string }) => e.name === "Validated answer");
    expect(checks.map((c: { payload: { passed: boolean } }) => c.payload.passed)).toEqual([false, true]);
    expect(checks[0].payload.problems[0].message).toMatch(/Numbers not tied to a metric/);
    // The repair request told the model exactly what failed.
    const repairRequest = model.requests.filter((r) => r.task === "explain")[1]!;
    expect(JSON.stringify(repairRequest.messages)).toMatch(/failed checks and was not saved/);
    const stored = (await turnRow(turnId)).reply_data.reply.statements[0].text;
    expect(stored).not.toContain("2.6%");
  });

  it("fails honestly when the answer still does not pass, saving nothing", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => {
      const bad = goodReply();
      bad.statements[0] = observation("The photo caused a CTR of 2.6%.", ["metric:RL-PIN-0901:ctr"]);
      return finish(bad, reportArtifact());
    }));
    const { turnId, executionId, conversationId } = await w.submit("ridgeline-outfitters", "Create a report for the last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    const turn = await turnRow(turnId);
    expect(turn.status).toBe("failed");
    expect(turn.reply_kind).toBe("failure");
    expect(turn.reply_message).toMatch(/did not pass the evidence checks/);
    expect(turn.reply_message).toMatch(/existing work is unchanged/i);
    const exec = await executionRow(executionId);
    expect(exec.status).toBe("failed");
    expect(exec.error_code).toBe("validation_failed");
    expect((await h.db.query("select count(*)::int n from artifacts where conversation_id = $1", [conversationId])).rows[0].n).toBe(0);
    expect(model.requests.filter((r) => r.task === "explain")).toHaveLength(2); // one repair, no more
  });

  it("rejects citations to records that were never retrieved", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => {
      const bad = goodReply();
      bad.statements[0] = { type: "observation", text: "Noted.", metricIds: [], sourceRefs: ["velvet-static:VS-MET-0901"] };
      return finish(bad);
    }));
    const { turnId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("failed");
  });
});

describe("attachments and difficult files", () => {
  it("reports missing values from an attached export as unavailable, never zero", async () => {
    const w = await h.newWorld();
    const sourceId = w.source[`${w.client["ridgeline-outfitters"]}:ridgeline-pinterest-partial-export.csv`]!;
    let gather = 0;
    const model = new ScriptedModel((request) => {
      if (phase(request) === "compose") {
        return finish({
          message: "I added the October export.",
          statements: [
            observation("Winter Shell Preview reached a CTR of {{metric:RL-PIN-1001:ctr}}.", ["metric:RL-PIN-1001:ctr"]),
            observation("Its conversions were {{metric:RL-PIN-1001:conversions}} because the export left them blank.", []),
            observation("Gift Guide Teaser CTR was {{metric:RL-PIN-1002:ctr}} with no impressions recorded.", []),
          ],
        });
      }
      gather++;
      if (gather === 1) return [toolCall("retrieve_campaigns", { sourceId })];
      if (gather === 2) return [toolCall("calculate_metrics", { label: "Winter Shell", campaignIds: ["RL-PIN-1001"] }), toolCall("calculate_metrics", { label: "Gift Guide", campaignIds: ["RL-PIN-1002"] })];
      return [toolCall("ready_to_answer")];
    });
    const { turnId } = await w.submit("ridgeline-outfitters", "Add the October export to the report.", { attachments: [sourceId] });
    await h.drain(h.worker(model));
    // "because" inside an observation is a causal claim; the validator is strict, so reword in the repair.
    expect((await turnRow(turnId)).status).toBe("failed");

    const gather2 = { n: 0 };
    const retry = new ScriptedModel((request) => {
      if (phase(request) === "compose") {
        return finish({
          message: "I added the October export.",
          statements: [
            observation("Winter Shell Preview reached a CTR of {{metric:RL-PIN-1001:ctr}}.", ["metric:RL-PIN-1001:ctr"]),
            observation("Its conversions are {{metric:RL-PIN-1001:conversions}}; the export left them blank.", []),
            observation("Gift Guide Teaser CTR is {{metric:RL-PIN-1002:ctr}}; no impressions were recorded.", []),
          ],
        });
      }
      gather2.n++;
      if (gather2.n === 1) return [toolCall("retrieve_campaigns", { sourceId })];
      if (gather2.n === 2) return [toolCall("calculate_metrics", { label: "Winter Shell", campaignIds: ["RL-PIN-1001"] }), toolCall("calculate_metrics", { label: "Gift Guide", campaignIds: ["RL-PIN-1002"] })];
      return [toolCall("ready_to_answer")];
    });
    const second = await w.submit("ridgeline-outfitters", "Add the October export to the report.", { attachments: [sourceId] });
    await h.drain(h.worker(retry));
    expect((await turnRow(second.turnId)).status).toBe("succeeded");
    const reply = (await w.get(`/v1/clients/${w.client["ridgeline-outfitters"]}/conversation`)).json().turns.find((t: { id: string }) => t.id === second.turnId).reply;
    expect(reply.statements[0].text).toBe(`Winter Shell Preview reached a CTR of ${((3380 / 260000) * 100).toFixed(2)}%.`);
    expect(reply.statements[1].text).toBe("Its conversions are unavailable; the export left them blank.");
    expect(reply.statements[2].text).toBe("Gift Guide Teaser CTR is unavailable; no impressions were recorded.");
    expect(reply.evidence["metric:RL-PIN-1001:conversions"].unavailableReason).toMatch(/Missing conversions/);
    expect(reply.evidence["metric:RL-PIN-1002:ctr"].unavailableReason).toMatch(/impressions is zero/);
    const rows = retry.requests.flatMap((r) => recentToolResults(r)).find((t) => t.name === "retrieve_campaigns");
    expect(JSON.stringify(rows?.value)).toContain("missingValues");
  });

  it("labels attachment text as untrusted and does not act on embedded instructions", async () => {
    const w = await h.newWorld();
    const sourceId = w.source[`${w.client["ridgeline-outfitters"]}:injected-client-email.md`]!;
    let gather = 0;
    const model = new ScriptedModel((request) => {
      if (phase(request) === "compose") {
        return finish({ message: "I read the email. It contains instructions aimed at an assistant, which I ignored.", statements: [{ type: "note", text: "The embedded instructions were ignored; only the client's actual requests were used." }] });
      }
      gather++;
      return gather === 1 ? [toolCall("read_source", { sourceId })] : [toolCall("ready_to_answer")];
    });
    const { turnId } = await w.submit("ridgeline-outfitters", "Summarize the attached email.", { attachments: [sourceId] });
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const read = model.requests.flatMap((r) => recentToolResults(r)).find((t) => t.name === "read_source");
    expect(read?.value.trust).toMatch(/untrusted_document/);
    // The confidential text of another client never entered this conversation, even though the email asked for it.
    expect(JSON.stringify(model.requests)).not.toMatch(/Mara Voss|embargo/);
    // Nothing in the stored answer repeats the injected claim.
    expect(JSON.stringify((await turnRow(turnId)).reply_data)).not.toMatch(/300 percent/);
  });

  it("refuses attachments that belong to another client, another visitor, or do not exist", async () => {
    const a = await h.newWorld();
    const b = await h.newWorld();
    const marloweEu = a.source[`${a.client["marlowe-finch"]}:marlowe-finch-eu-campaigns.csv`]!;
    const foreign = b.source[`${b.client["ridgeline-outfitters"]}:ridgeline-pinterest-partial-export.csv`]!;
    for (const attachments of [[marloweEu], [foreign], ["00000000-0000-4000-8000-000000000000"]]) {
      const res = await a.post(`/v1/clients/${a.client["ridgeline-outfitters"]}/turns`, { message: "Use this file.", attachmentSourceIds: attachments }, { "idempotency-key": `att-${Math.random()}-0000` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_attachment");
    }
  });
});

describe("failures never look like completed work", () => {
  it("retries transient provider errors up to the limit, records each attempt, then fails the turn", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(() => retryable("provider overloaded"));
    const { turnId, executionId, conversationId } = await w.submit("ridgeline-outfitters", "Create a report.");
    await h.drain(h.worker(model));
    expect(model.requests).toHaveLength(3);
    const calls = (await h.db.query("select attempt, error from model_calls where execution_id = $1 order by created_at", [executionId])).rows;
    expect(calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
    expect(calls.every((c) => /overloaded/.test(c.error))).toBe(true);
    const turn = await turnRow(turnId);
    expect(turn.status).toBe("failed");
    expect(turn.reply_message).toMatch(/AI provider failed/);
    expect((await executionRow(executionId)).status).toBe("failed");
    expect((await h.db.query("select count(*)::int n from artifacts where conversation_id = $1", [conversationId])).rows[0].n).toBe(0);
    const agency = (await h.db.query("select tokens_reserved from agencies where id = $1", [w.agencyId])).rows[0];
    expect(Number(agency.tokens_reserved)).toBe(0); // reservations are released on failure
  });

  it("recovers when a transient error clears on the second attempt", async () => {
    const w = await h.newWorld();
    let first = true;
    const inner = latestTwoScript(() => finish(goodReply()));
    const model = new ScriptedModel((request, index, history) => {
      if (first) {
        first = false;
        return retryable();
      }
      return inner(request, index, history);
    });
    const { turnId, executionId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const attempts = (await h.db.query("select attempt, error is not null as failed from model_calls where execution_id = $1 order by created_at limit 2", [executionId])).rows;
    expect(attempts).toEqual([{ attempt: 1, failed: true }, { attempt: 2, failed: false }]);
  });

  it("does not retry or hop models on a permanent error that is not model-specific", async () => {
    const w = await h.newWorld();
    const { ModelError } = await import("../ai/types.js");
    const model = new ScriptedModel(() => new ModelError("unprocessable", false, 422));
    const { turnId } = await w.submit("ridgeline-outfitters", "Hello");
    await h.drain(h.worker(model));
    expect(model.requests).toHaveLength(1);
    expect((await turnRow(turnId)).status).toBe("failed");
  });

  it("fails clearly when the session's model budget is exhausted", async () => {
    const w = await h.newWorld();
    await h.db.query("update agencies set token_budget = 50 where id = $1", [w.agencyId]);
    const model = new ScriptedModel(() => [toolCall("discover_sources")]);
    const { turnId, executionId } = await w.submit("ridgeline-outfitters", "Hello");
    await h.drain(h.worker(model));
    expect(model.requests).toHaveLength(0);
    const turn = await turnRow(turnId);
    expect(turn.status).toBe("failed");
    expect(turn.reply_message).toMatch(/model budget/);
    expect((await executionRow(executionId)).error_code).toBe("token_budget_exhausted");
  });

  it("caps tool steps instead of looping, then still composes an honest answer", async () => {
    const w = await h.newWorld();
    const { turnId } = await w.submit("ridgeline-outfitters", "Keep going forever.");
    // This model never says it is ready to answer.
    const model = new ScriptedModel((request) => (phase(request) === "compose" ? [toolCall("finish", { reply: { message: "I could not finish gathering evidence.", statements: [] } })] : [toolCall("discover_sources")]));
    await h.drain(h.worker(model));
    expect(model.requests.filter((r) => r.task === "interpret")).toHaveLength(8);
    expect((await turnRow(turnId)).status).toBe("succeeded");
  });

  it("stops before the next step when a run is cancelled, and never marks it complete", async () => {
    const w = await h.newWorld();
    let executionId = "";
    const model = new ScriptedModel(async (request, index) => {
      if (index === 0) await requestCancel(h.db, w.agencyId, executionId);
      return [toolCall("discover_sources")];
    });
    const submitted = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    executionId = submitted.executionId;
    // Claim directly so the cancel lands while the run is in progress.
    await h.drain(h.worker(model));
    const turn = await turnRow(submitted.turnId);
    expect(turn.status).toBe("cancelled");
    expect((await executionRow(executionId)).status).toBe("cancelled");
    expect(model.requests).toHaveLength(1);
  });
});

describe("model fallbacks", () => {
  it("retries a transient error once on the same model, then falls back, recording every attempt", async () => {
    const w = await h.newWorld();
    const inner = latestTwoScript(() => finish(goodReply()));
    const primary = h.config.routing.interpret.primary;
    const model = new ScriptedModel((request, index, history) => (request.models[0] === primary && request.task === "interpret" ? retryable("primary down") : inner(request, index, history)));
    const { turnId, executionId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");

    const calls = (await h.db.query("select task, attempt, requested_model, error from model_calls where execution_id = $1 and task = 'interpret' order by created_at limit 3", [executionId])).rows;
    expect(calls.map((c) => [c.attempt, c.requested_model, c.error ? "failed" : "ok"])).toEqual([
      [1, primary, "failed"],
      [2, primary, "failed"],
      [3, h.config.routing.interpret.fallbacks[0], "ok"],
    ]);
    const events = (await h.db.query("select payload from execution_events where execution_id = $1 and name = 'Fallback model used'", [executionId])).rows;
    expect(events[0].payload).toMatchObject({ task: "interpret", primary, used: h.config.routing.interpret.fallbacks[0] });
    // Once the primary has failed, later calls go straight to the model that works instead of retrying it every time.
    expect(events).toHaveLength(1);
    const later = (await h.db.query("select requested_model from model_calls where execution_id = $1 and task = 'interpret' order by created_at offset 3", [executionId])).rows;
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((c) => c.requested_model === h.config.routing.interpret.fallbacks[0])).toBe(true);
  });

  it("moves straight to the fallback when the primary rejects the request itself", async () => {
    const w = await h.newWorld();
    const { ModelError } = await import("../ai/types.js");
    const primary = h.config.routing.interpret.primary;
    const inner = latestTwoScript(() => finish(goodReply()));
    const model = new ScriptedModel((request, index, history) =>
      request.models[0] === primary ? new ModelError("tool_choice not supported for this model", false, 400) : inner(request, index, history));
    const { turnId, executionId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const first = (await h.db.query("select attempt, requested_model, error from model_calls where execution_id = $1 and task = 'interpret' order by created_at limit 2", [executionId])).rows;
    expect(first.map((c) => [c.attempt, c.requested_model === primary ? "primary" : "fallback", c.error ? "failed" : "ok"])).toEqual([[1, "primary", "failed"], [2, "fallback", "ok"]]);
  });

  it("does not hop models on an account-level error such as bad credentials", async () => {
    const w = await h.newWorld();
    const { ModelError } = await import("../ai/types.js");
    const model = new ScriptedModel(() => new ModelError("invalid API key", false, 401));
    const { turnId } = await w.submit("ridgeline-outfitters", "Hello");
    await h.drain(h.worker(model));
    expect(model.requests).toHaveLength(1);
    expect((await turnRow(turnId)).status).toBe("failed");
  });

  it("fails when every candidate fails, without exceeding the attempt limit", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(() => retryable("everything is down"));
    const { turnId } = await w.submit("ridgeline-outfitters", "Hello");
    await h.drain(h.worker(model));
    expect(model.requests.length).toBeLessThanOrEqual(3);
    expect((await turnRow(turnId)).status).toBe("failed");
  });
});

describe("follow-ups reuse earlier work", () => {
  it("cites metrics calculated in an earlier turn without recalculating them", async () => {
    const w = await h.newWorld();
    const first = new ScriptedModel(latestTwoScript(() => finish(goodReply())));
    await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(first));

    // The follow-up gathers nothing and reuses the verified metrics from the answer above.
    const second = new ScriptedModel((request) => {
      if (phase(request) === "gather") return [toolCall("ready_to_answer")];
      return finish(
        { message: "Here is the report.", statements: [] },
        reportArtifact(),
      );
    });
    const { turnId, conversationId } = await w.submit("ridgeline-outfitters", "Make that into a performance report.");
    await h.drain(h.worker(second));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    expect(second.requests.filter((r) => r.task === "interpret")).toHaveLength(1);
    // The model was told what already exists, so it does not have to guess ids.
    const system = second.requests[0]!.messages[0]!.content!;
    expect(system).toMatch(/ALREADY CALCULATED/);
    expect(system).toContain('scope "RL-PIN-0901"');
    expect(system).toMatch(/cmp:RL-PIN-0901->RL-PIN-0902/);
    const version = (await h.db.query("select v.checks from artifact_versions v join artifacts a on a.id = v.artifact_id where a.conversation_id = $1", [conversationId])).rows[0];
    expect(version.checks.claims.verified).toBe(version.checks.claims.total);
  });

  it("still rejects ids that were never calculated anywhere in the conversation", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel((request) => {
      if (phase(request) === "gather") return [toolCall("ready_to_answer")];
      return finish({ message: "Done.", statements: [observation("CTR was {{metric:RL-PIN-0901:ctr}}.", ["metric:RL-PIN-0901:ctr"])] });
    });
    const { turnId } = await w.submit("ridgeline-outfitters", "Make that into a performance report.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("failed");
  });

  it("does not accept an empty answer after calculating metrics", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish({ message: "Done.", statements: [] })));
    const { turnId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("failed");
  });
});

describe("answers that forget the tool", () => {
  it("nudges a model that replies in plain text and does not spend the repair on it", async () => {
    const w = await h.newWorld();
    let composeCalls = 0;
    const model = new ScriptedModel(latestTwoScript(() => {
      composeCalls++;
      return composeCalls <= 2 ? { content: "Here is my answer in plain text." } : finish(goodReply());
    }));
    const { turnId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect(composeCalls).toBe(3);
    expect((await turnRow(turnId)).status).toBe("succeeded");
  });

  it("gives up after a few nudges instead of looping", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => ({ content: "I will not use the tool." })));
    const { turnId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect(model.requests.filter((r) => r.task === "explain")).toHaveLength(3);
    expect((await turnRow(turnId)).status).toBe("failed");
  });

  it("accepts a bare campaign ID as a citation of the campaign that was retrieved", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => {
      const reply = goodReply();
      reply.statements[0] = { type: "observation", text: "See the campaign rows.", metricIds: [], sourceRefs: ["RL-PIN-0901", "ridgeline-outfitters:RL-PIN-0902"] };
      return finish(reply);
    }));
    const { turnId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
  });
});

describe("truncated output", () => {
  it("tells the model its answer was cut off instead of reporting invalid JSON, then accepts a shorter one", async () => {
    const w = await h.newWorld();
    let composeCalls = 0;
    const model = new ScriptedModel(latestTwoScript(() => {
      composeCalls++;
      if (composeCalls === 1) {
        const cutOff = { id: "call_cut", type: "function" as const, function: { name: "finish", arguments: '{"reply": {"message": "cut' } };
        return { calls: [cutOff], finishReason: "length" };
      }
      return finish(goodReply());
    }));
    const { turnId, executionId } = await w.submit("ridgeline-outfitters", "Compare our last two Pinterest campaigns.");
    await h.drain(h.worker(model));
    expect((await turnRow(turnId)).status).toBe("succeeded");
    const checks = (await w.get(`/v1/executions/${executionId}/events`)).json().events.filter((e: { name: string }) => e.name === "Validated answer");
    expect(checks[0].payload.problems[0].message).toMatch(/cut off at the length limit/);
  });
});

describe("submitting turns", () => {
  it("is idempotent: the same key returns the original turn", async () => {
    const w = await h.newWorld();
    const first = await w.submit("ridgeline-outfitters", "Hello", { key: "same-key-12345" });
    const again = await w.post(`/v1/clients/${w.client["ridgeline-outfitters"]}/turns`, { message: "Hello" }, { "idempotency-key": "same-key-12345" });
    expect(again.statusCode).toBe(200);
    expect(again.json().turnId).toBe(first.turnId);
    expect(again.json().duplicate).toBe(true);
    expect((await h.db.query("select count(*)::int n from turns where conversation_id = $1", [first.conversationId])).rows[0].n).toBe(1);
  });

  it("requires an idempotency key and limits pending turns", async () => {
    const w = await h.newWorld();
    const url = `/v1/clients/${w.client["ridgeline-outfitters"]}/turns`;
    expect((await w.post(url, { message: "Hello" })).statusCode).toBe(400);
    for (let i = 0; i < 3; i++) await w.submit("ridgeline-outfitters", `Q${i}`);
    const fourth = await w.post(url, { message: "Q4" }, { "idempotency-key": "pending-limit-1234" });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe("too_many_pending");
  });

  it("keeps one client's conversation separate from another's", async () => {
    const w = await h.newWorld();
    await w.submit("ridgeline-outfitters", "Hello Ridgeline");
    const marlowe = (await w.get(`/v1/clients/${w.client["marlowe-finch"]}/conversation`)).json();
    expect(marlowe.turns).toEqual([]);
  });

  it("does not show another visitor's executions", async () => {
    const a = await h.newWorld();
    const b = await h.newWorld();
    const { executionId } = await a.submit("ridgeline-outfitters", "Hello");
    expect((await b.get(`/v1/executions/${executionId}`)).statusCode).toBe(404);
    expect((await b.get(`/v1/executions/${executionId}/events`)).statusCode).toBe(404);
    expect((await b.post(`/v1/executions/${executionId}/cancel`, {})).statusCode).toBe(409);
  });
});

describe("stored payloads", () => {
  const secretKey = "sk-or-v1-abcdefghijklmnopqrstuvwxyz";

  it("redact credentials wherever they appear", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish(goodReply())));
    const { executionId } = await w.submit("ridgeline-outfitters", `My key is ${secretKey}. Compare our last two Pinterest campaigns.`);
    await h.drain(h.worker(model, { payloadMaxBytes: 200_000 }));
    const stored = (await h.db.query("select request_payload::text as req, response_payload::text as res from model_calls where execution_id = $1", [executionId])).rows;
    expect(stored.some((r) => (r.req ?? "").includes("[redacted]"))).toBe(true);
    expect(stored.some((r) => (r.req ?? "").includes(secretKey) || (r.res ?? "").includes(secretKey))).toBe(false);
    const events = (await h.db.query("select payload::text as p from execution_events where execution_id = $1", [executionId])).rows;
    expect(events.some((e) => (e.p ?? "").includes(secretKey))).toBe(false);
    // The user's own message is kept as they wrote it; only the inspection records are redacted.
    const turn = (await h.db.query("select user_message from turns where conversation_id in (select conversation_id from turns where agency_id = $1)", [w.agencyId])).rows[0];
    expect(turn.user_message).toContain(secretKey);
  });

  it("bound payload size with a visible marker instead of silently cutting", async () => {
    const w = await h.newWorld();
    const model = new ScriptedModel(latestTwoScript(() => finish(goodReply())));
    const { executionId } = await w.submit("ridgeline-outfitters", `My key is ${secretKey}. Compare our last two Pinterest campaigns.`);
    await h.drain(h.worker(model, { payloadMaxBytes: 1500 }));
    const stored = (await h.db.query("select request_payload::text as req, payload_truncated from model_calls where execution_id = $1", [executionId])).rows;
    const truncated = stored.filter((r) => r.payload_truncated);
    expect(truncated.length).toBeGreaterThan(0);
    for (const row of truncated) {
      expect(row.req).toMatch(/"_truncated": ?true/);
      expect(row.req).toMatch(/originalBytes/);
      expect(row.req).not.toContain(secretKey);
    }
  });
});
