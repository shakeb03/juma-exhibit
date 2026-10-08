import { createPool, deleteExpiredAgencies, pingDatabase } from "@exhibit/database";
import { OpenRouterClient } from "./ai/openrouter.js";
import { runClientTurn } from "./agent/clientTurn.js";
import { Worker } from "./exec/worker.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const db = createPool({ connectionString: config.databaseUrl, max: 5 });
const app = buildApp(config, { pingDatabase: () => pingDatabase(db), db, sessionConfig: config });

// Expired demo agencies are removed with all their data. Failures here must not stop the server.
const sweep = () => deleteExpiredAgencies(db).then(
  (count) => count > 0 && app.log.info({ count }, "removed expired demo agencies"),
  (err) => app.log.error({ err }, "expired-agency sweep failed"),
);
void sweep();
setInterval(sweep, 15 * 60 * 1000).unref();

// Background runner. It uses the direct Neon connection so leases do not depend on pooler session behavior.
const runnerDb = createPool({ connectionString: config.directDatabaseUrl, max: 4 });
const worker = new Worker({
  db: runnerDb,
  models: new OpenRouterClient({ apiKey: config.openRouterApiKey, referer: config.appOrigin, title: "Exhibit A" }),
  routing: config.routing,
  handlers: { turn: (ctx, execution) => runClientTurn(ctx, execution.turnId!) },
  backendCommit: config.commit,
  payloadMaxBytes: config.payloadMaxBytes,
  runTimeoutMs: config.runTimeoutMs,
  log: (message, data) => app.log.warn({ data }, message),
});
if (config.workerEnabled) worker.start();

const shutdown = async () => {
  await worker.stop();
  await runnerDb.end();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
