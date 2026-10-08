import { createPool, pingDatabase } from "@exhibit/database";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const db = createPool({ connectionString: config.databaseUrl, max: 5 });
const app = buildApp(config, { pingDatabase: () => pingDatabase(db) });

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
