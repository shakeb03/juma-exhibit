import pg from "pg";

export type Database = pg.Pool;

export interface PoolOptions {
  connectionString: string;
  /** Keep pools small; Neon connections are limited. */
  max?: number;
  statementTimeoutMs?: number;
}

/** Create a bounded pool. TLS settings come from the Neon connection string. */
export function createPool(options: PoolOptions): Database {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Cheap connectivity check used by the readiness endpoint. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.query("select 1");
}
