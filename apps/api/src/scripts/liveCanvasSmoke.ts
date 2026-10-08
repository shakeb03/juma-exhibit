// Runs real cross-client chat turns on the intelligence canvas against real models, then cleans up.
// Usage: pnpm --filter @exhibit/api smoke:canvas -- "<message>" ["<message>" ...]
import { createPool } from "@exhibit/database";
import { OpenRouterClient } from "../ai/openrouter.js";
import { runTurn } from "../agent/runTurn.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { Worker } from "../exec/worker.js";
import { SESSION_COOKIE } from "../session/plugin.js";

const messages = process.argv.slice(2).filter((a) => a !== "--");
if (messages.length === 0) {
  messages.push(
    "Use the visual patterns supported by Ridgeline's evidence and Marlowe & Finch's storytelling examples to propose three concepts for Tidewell Swim.",
    "Also borrow Velvet Static's best-performing tactics.",
  );
}

const config = loadConfig({ ...process.env, BACKEND_PROXY_SECRET: "smoke-test-secret-0123456789" } as NodeJS.ProcessEnv);
const db = createPool({ connectionString: config.databaseUrl, max: 4 });
const app = buildApp(config, { pingDatabase: async () => {}, db, sessionConfig: config, logger: false });
const secret = { "x-proxy-secret": config.proxySecret };
const worker = new Worker({
  db, models: new OpenRouterClient({ apiKey: config.openRouterApiKey, title: "Exhibit A canvas smoke" }), routing: config.routing,
  handlers: { turn: (ctx, execution) => runTurn(ctx, execution.turnId!) },
  backendCommit: "smoke", payloadMaxBytes: config.payloadMaxBytes, runTimeoutMs: config.runTimeoutMs,
});

const session = await app.inject({ method: "POST", url: "/v1/session", payload: {}, headers: { ...secret, "x-client-ip": "203.0.113.251" } });
const agencyId = session.json().agencyId as string;
const headers = { ...secret, cookie: `${SESSION_COOKIE}=${session.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`, "x-csrf-token": session.json().csrfToken as string };

try {
  // Connect every seeded node to the chat node, including the restricted client. Connection alone grants nothing.
  const canvas = (await app.inject({ method: "GET", url: "/v1/canvas", headers })).json();
  const edges = canvas.nodes.filter((n: { type: string }) => n.type !== "chat").map((n: { id: string }) => ({ id: `${n.id}->chat-1`, source: n.id, target: "chat-1" }));
  await app.inject({ method: "PUT", url: "/v1/canvas", headers, payload: { baseRevision: canvas.revision, nodes: canvas.nodes, edges } });
  const passport = (await app.inject({ method: "GET", url: "/v1/canvas/passport?chatNodeId=chat-1", headers })).json().passport;
  console.log("\nPASSPORT");
  for (const e of passport.entries) console.log(`  ${e.title.padEnd(22)} ${e.status.padEnd(10)} shared=${e.fieldsShared}${e.reasons.length ? ` | ${e.reasons[0]}` : ""}`);

  let latest: string | undefined;
  for (const [index, message] of messages.entries()) {
    console.log(`\n=== Turn ${index + 1}: ${message}`);
    const started = Date.now();
    const submit = await app.inject({
      method: "POST", url: "/v1/canvas/chats/chat-1/turns", headers: { ...headers, "idempotency-key": `canvas-smoke-${Date.now()}-${index}` },
      payload: { message, referencedVersionId: latest },
    });
    const { executionId, turnId } = submit.json() as { executionId: string; turnId: string };
    while (await worker.runOne()) { /* drain */ }
    const conversation = (await app.inject({ method: "GET", url: "/v1/canvas/chats/chat-1/conversation", headers })).json();
    const turn = conversation.turns.find((t: { id: string }) => t.id === turnId);
    console.log(`status=${turn.status} kind=${turn.replyKind} time=${((Date.now() - started) / 1000).toFixed(1)}s stale=${JSON.stringify(turn.reply?.stale ?? [])}`);
    if (turn.reply?.statements) {
      console.log(`\n${turn.reply.message}`);
      for (const s of turn.reply.statements) console.log(`  [${s.type}] ${s.text}`);
      console.log(`  claims verified: ${turn.reply.claims?.verified} of ${turn.reply.claims?.total}`);
    } else console.log(turn.reply?.message ?? "(no reply)", turn.reply?.options ?? "");
    if (turn.artifact) {
      latest = turn.artifact.versionId;
      const version = (await app.inject({ method: "GET", url: `/v1/artifact-versions/${latest}`, headers })).json();
      console.log(`\n--- Artifact v${version.version} (${version.kind})`);
      for (const b of version.renderedBlocks) {
        const text = b.text ?? b.title ?? b.caption ?? "";
        console.log(`  <${b.type}> ${text}${b.hypothesis ? ` | hypothesis: ${b.hypothesis}` : ""}${b.design ? ` | design: ${b.design}` : ""}${b.measurement ? ` | measure: ${b.measurement}` : ""}${b.limitation ? ` | limit: ${b.limitation}` : ""}`);
      }
    }
    if (turn.status === "failed") {
      const raw = (await db.query("select response_payload from model_calls where execution_id = $1 order by created_at limit 1", [executionId])).rows[0]?.response_payload;
      const args = raw?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      console.log(`  FIRST RAW ANSWER (${typeof args === "string" ? args.length : 0} chars): ${typeof args === "string" ? args.slice(0, 1400) : JSON.stringify(raw).slice(0, 600)}`);
    }
    const calls = (await db.query("select task, requested_model, actual_model, input_tokens, output_tokens, duration_ms, cost_usd, error from model_calls where execution_id = $1 order by created_at", [executionId])).rows;
    for (const c of calls) console.log(`  model ${c.task} ${c.actual_model ?? c.requested_model} in=${c.input_tokens} out=${c.output_tokens} ${c.duration_ms}ms cost=${c.cost_usd ?? "n/a"}${c.error ? ` ERROR ${c.error}` : ""}`);
    const checks = (await db.query("select payload from execution_events where execution_id = $1 and kind = 'check' order by id", [executionId])).rows;
    for (const c of checks) console.log(`  check passed=${c.payload.passed} ${c.payload.numericalClaims}${c.payload.problems?.length ? ` problems=${JSON.stringify(c.payload.problems.slice(0, 4))}` : ""}`);
    const perms = (await db.query("select name from execution_events where execution_id = $1 and kind = 'permission' order by id", [executionId])).rows;
    console.log(`  permissions: ${perms.map((p) => p.name).join("; ") || "none excluded"}`);
  }
} finally {
  await db.query("delete from agencies where id = $1", [agencyId]);
  await db.end();
}
