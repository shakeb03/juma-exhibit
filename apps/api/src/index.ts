import { createPool, deleteExpiredAgencies, pingDatabase } from "@exhibit/database";
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

const shutdown = async () => {
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
