import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "@exhibit/database";

const databaseUrl = process.env.DIRECT_DATABASE_URL;
if (!databaseUrl) {
  console.error("DIRECT_DATABASE_URL is required to run migrations.");
  process.exit(1);
}

// Works from the repo root (Railway) and from apps/api (local script).
const candidates = [
  process.env.MIGRATIONS_DIR,
  resolve(process.cwd(), "packages/database/migrations"),
  resolve(process.cwd(), "../../packages/database/migrations"),
].filter((dir): dir is string => Boolean(dir));
const dir = candidates.find((candidate) => existsSync(candidate));
if (!dir) {
  console.error(`Migrations directory not found. Looked in:\n${candidates.join("\n")}`);
  process.exit(1);
}

const applied = await runMigrations({ databaseUrl, dir });
console.log(`Migrations complete. Applied ${applied.length} this run.`);
