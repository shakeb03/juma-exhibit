import type pg from "pg";
import type { Database } from "./pool.js";

export type Queryable = Pick<pg.ClientBase, "query">;

/** Run work on one checked-out connection inside a transaction. Rolls back on any error. */
export async function withTransaction<T>(db: Database, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Parameterized multi-row insert. Table and column names must be code constants
 * (they are checked against a strict identifier pattern); all values are bound parameters.
 */
export async function insertMany(
  db: Queryable,
  table: string,
  columns: string[],
  rows: unknown[][],
  returning = "id",
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  for (const name of [table, ...columns]) {
    if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  }
  const results: Record<string, unknown>[] = [];
  // Stay well under Postgres's 65,535-parameter limit.
  const perChunk = Math.max(1, Math.floor(30_000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      if (row.length !== columns.length) throw new Error(`Row has ${row.length} values for ${columns.length} columns.`);
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const sql = `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")} returning ${returning}`;
    const result = await db.query(sql, params);
    results.push(...result.rows);
  }
  return results;
}
