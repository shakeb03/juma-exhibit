import type { Database } from "./pool.js";
import type { Queryable } from "./transaction.js";

export interface SessionRecord {
  sessionId: string;
  agencyId: string;
  expiresAt: Date;
}

export async function createAgency(
  db: Queryable,
  options: { ttlMs: number; tokenBudget: number },
): Promise<{ id: string; expiresAt: Date }> {
  const result = await db.query(
    `insert into agencies (expires_at, token_budget)
     values (now() + ($1 || ' milliseconds')::interval, $2)
     returning id, expires_at`,
    [String(options.ttlMs), options.tokenBudget],
  );
  const row = result.rows[0];
  return { id: row.id, expiresAt: row.expires_at };
}

export async function createSession(
  db: Queryable,
  options: { agencyId: string; tokenHash: string; expiresAt: Date },
): Promise<string> {
  const result = await db.query(
    `insert into sessions (agency_id, token_hash, expires_at) values ($1, $2, $3) returning id`,
    [options.agencyId, options.tokenHash, options.expiresAt],
  );
  return result.rows[0].id;
}

/** Valid only while both the session and its agency are unexpired. */
export async function findSession(db: Queryable, tokenHash: string): Promise<SessionRecord | null> {
  const result = await db.query(
    `select s.id as session_id, s.agency_id, s.expires_at
       from sessions s
       join agencies a on a.id = s.agency_id
      where s.token_hash = $1 and s.expires_at > now() and a.expires_at > now()`,
    [tokenHash],
  );
  const row = result.rows[0];
  return row ? { sessionId: row.session_id, agencyId: row.agency_id, expiresAt: row.expires_at } : null;
}

/** Deleting the agency removes all of its data through cascading foreign keys. */
export async function deleteAgency(db: Queryable, agencyId: string): Promise<void> {
  await db.query("delete from agencies where id = $1", [agencyId]);
}

export async function deleteExpiredAgencies(db: Database): Promise<number> {
  const result = await db.query("delete from agencies where expires_at <= now()");
  return result.rowCount ?? 0;
}

export async function countActiveAgencies(db: Queryable): Promise<number> {
  const result = await db.query("select count(*)::int as n from agencies where expires_at > now()");
  return result.rows[0].n;
}
