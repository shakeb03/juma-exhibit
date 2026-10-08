import { runner } from "node-pg-migrate";

export interface MigrateOptions {
  /** Direct (non-pooled) Neon connection string. */
  databaseUrl: string;
  /** Directory containing the versioned SQL migration files. */
  dir: string;
  direction?: "up" | "down";
  count?: number;
}

/** Apply versioned SQL migrations using node-pg-migrate's ledger and locking. */
export async function runMigrations(options: MigrateOptions) {
  return runner({
    databaseUrl: options.databaseUrl,
    dir: options.dir,
    direction: options.direction ?? "up",
    count: options.count ?? Infinity,
    migrationsTable: "pgmigrations",
    checkOrder: true,
    log: (message) => console.log(message),
  });
}
