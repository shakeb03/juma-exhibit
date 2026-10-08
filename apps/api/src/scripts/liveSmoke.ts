// Runs real turns through the real queue and worker against real models on OpenRouter, then cleans up.
// Usage: pnpm --filter @exhibit/api smoke -- "<client-slug>" "<message>" ["<follow-up>" ...]
import { createPool } from "@exhibit/database";
import { OpenRouterClient } from "../ai/openrouter.js";
import { runClientTurn } from "../agent/clientTurn.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { Worker } from "../exec/worker.js";
import { SESSION_COOKIE } from "../session/plugin.js";

const [slug = "ridgeline-outfitters", ...messages] = process.argv.slice(2).filter((a) => a !== "--");
if (messages.length === 0) messages.push("Compare our last two Pinterest campaigns. Explain what changed and suggest what we should try next.");

const config = loadConfig({ ...process.env, BACKEND_PROXY_SECRET: "smoke-test-secret-0123456789" } as NodeJS.ProcessEnv);
const db = createPool({ connectionString: config.databaseUrl, max: 4 });
const app = buildApp(config, { pingDatabase: async () => {}, db, sessionConfig: config, logger: false });
const secret = { "x-proxy-secret": config.proxySecret };

const worker = new Worker({
  db,
  models: new OpenRouterClient({ apiKey: config.openRouterApiKey, title: "Exhibit A smoke" }),
  routing: config.routing,
  handlers: { turn: (ctx, execution) => runClientTurn(ctx, execution.turnId!) },
  backendCommit: "smoke",
  payloadMaxBytes: config.payloadMaxBytes,
  runTimeoutMs: config.runTimeoutMs,
});

const session = await app.inject({ method: "POST", url: "/v1/session", payload: {}, headers: { ...secret, "x-client-ip": "203.0.113.250" } });
const agencyId = session.json().agencyId as string;
const headers = {
  ...secret,
  cookie: `${SESSION_COOKIE}=${session.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`,
  "x-csrf-token": session.json().csrfToken as string,
};

try {
  const client = (await db.query("select id from clients where agency_id = $1 and slug = $2", [agencyId, slug])).rows[0]?.id;
  if (!client) throw new Error(`Unknown client slug: ${slug}`);

  let latestVersionId: string | undefined;
  for (const [index, message] of messages.entries()) {
    console.log(`\n=== Turn ${index + 1}: ${message}`);
    const started = Date.now();
    const submit = await app.inject({
      method: "POST", url: `/v1/clients/${client}/turns`, headers: { ...headers, "idempotency-key": `smoke-${Date.now()}-${index}` },
      payload: { message, attachmentSourceIds: [], referencedVersionId: latestVersionId },
    });
    const { executionId, turnId } = submit.json() as { executionId: string; turnId: string };
    while (await worker.runOne()) { /* run until the queue is empty */ }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    const conversation = (await app.inject({ method: "GET", url: `/v1/clients/${client}/conversation`, headers })).json();
    const turn = conversation.turns.find((t: { id: string }) => t.id === turnId);
    console.log(`status=${turn.status} kind=${turn.replyKind} time=${seconds}s`);
    const reply = turn.reply;
    if (reply?.statements) {
      console.log(`\n${reply.message}`);
      for (const s of reply.statements) {
        console.log(`  [${s.type}] ${s.text}`);
        if (s.reasoning) console.log(`      why: ${s.reasoning}\n      measure: ${s.measurement}\n      limit: ${s.limitation}`);
      }
      if (reply.followUp) console.log(`\n  ${reply.followUp}`);
      console.log(`\n  claims verified: ${reply.claims?.verified} of ${reply.claims?.total}`);
    } else console.log(reply?.message ?? "(no reply)", reply?.options ?? "");

    if (turn.artifact) {
      latestVersionId = turn.artifact.versionId;
      const version = (await app.inject({ method: "GET", url: `/v1/artifact-versions/${latestVersionId}`, headers })).json();
      console.log(`\n--- Artifact v${version.version} (${version.kind}) caused by ${version.causeKind}`);
      for (const b of version.renderedBlocks) {
        const text = b.text ?? b.title ?? b.caption ?? "";
        console.log(`  <${b.type}> ${text}${b.reasoning ? ` | why: ${b.reasoning}` : ""}${b.measurement ? ` | measure: ${b.measurement}` : ""}${b.limitation ? ` | limit: ${b.limitation}` : ""}`);
      }
    }

    const calls = (await db.query(
      "select task, requested_model, actual_model, provider, input_tokens, output_tokens, duration_ms, cost_usd, error from model_calls where execution_id = $1 order by created_at",
      [executionId],
    )).rows;
    console.log("\n  model calls:");
    for (const c of calls) {
      console.log(`   ${c.task.padEnd(9)} ${String(c.actual_model ?? c.requested_model).padEnd(34)} in=${c.input_tokens ?? "-"} out=${c.output_tokens ?? "-"} ${c.duration_ms ?? "-"}ms cost=${c.cost_usd ?? "n/a"}${c.error ? ` ERROR ${c.error}` : ""}`);
    }
    const total = calls.reduce((n, c) => n + Number(c.cost_usd ?? 0), 0);
    console.log(`   total cost: $${total.toFixed(4)}`);
    const checks = (await db.query("select payload from execution_events where execution_id = $1 and kind = 'check' order by id", [executionId])).rows;
    for (const c of checks) console.log(`  check: passed=${c.payload.passed} ${c.payload.numericalClaims}${c.payload.problems?.length ? ` problems=${JSON.stringify(c.payload.problems)}` : ""}`);
    const tools = (await db.query("select name from execution_events where execution_id = $1 and kind = 'tool_call' order by id", [executionId])).rows;
    console.log(`  tools: ${tools.map((t) => t.name).join(" -> ")}`);
  }
} finally {
  await db.query("delete from agencies where id = $1", [agencyId]);
  await db.end();
}
