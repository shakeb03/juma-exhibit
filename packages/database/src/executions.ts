import type { QueryResultRow } from "pg";
import type { Queryable } from "./transaction.js";

export interface ExecutionRecord {
  id: string;
  agencyId: string;
  kind: "turn" | "comment_edit" | "export";
  turnId: string | null;
  status: string;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string | null;
  cancelRequested: boolean;
  backendCommit: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const mapExecution = (row: QueryResultRow): ExecutionRecord => ({
  id: row.id,
  agencyId: row.agency_id,
  kind: row.kind,
  turnId: row.turn_id,
  status: row.status,
  attempt: row.attempt,
  maxAttempts: row.max_attempts,
  leaseOwner: row.lease_owner,
  cancelRequested: row.cancel_requested,
  backendCommit: row.backend_commit,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  errorCode: row.error_code,
  errorMessage: row.error_message,
});

/**
 * Lease the next runnable execution. Safe with several workers: rows are locked with SKIP LOCKED.
 * Rules: an execution whose lease expired is recoverable; within a conversation only one execution runs
 * at a time and later turns wait for earlier ones, so artifact versions never race.
 */
export async function claimNextExecution(db: Queryable, owner: string, leaseMs: number): Promise<ExecutionRecord | null> {
  // Out of attempts and the lease expired: the run is dead, not recoverable.
  await db.query(
    `update executions set status = 'failed', error_code = 'lease_expired',
            error_message = 'The run stopped responding and used all of its attempts.',
            finished_at = now(), lease_owner = null, lease_expires_at = null
      where status = 'running' and lease_expires_at < now() and attempt >= max_attempts`,
  );
  await db.query(
    `update turns set status = 'failed', reply_kind = 'failure',
            reply_message = 'The run stopped responding. You can try again.', completed_at = now()
      where status = 'running' and id in (select turn_id from executions where status = 'failed' and error_code = 'lease_expired')`,
  );

  const result = await db.query(
    `update executions e
        set status = 'running', lease_owner = $1, lease_expires_at = now() + ($2 || ' milliseconds')::interval,
            attempt = e.attempt + 1, started_at = coalesce(e.started_at, now())
      where e.id = (
        select c.id
          from executions c
          left join turns t on t.id = c.turn_id
         where ((c.status in ('queued', 'waiting_to_retry') and c.available_at <= now())
                or (c.status = 'running' and c.lease_expires_at < now()))
           and c.cancel_requested = false
           and (t.id is null or (
                not exists (
                  select 1 from executions r join turns rt on rt.id = r.turn_id
                   where rt.conversation_id = t.conversation_id and r.id <> c.id
                     and r.status = 'running' and r.lease_expires_at >= now())
                and not exists (
                  select 1 from executions q join turns qt on qt.id = q.turn_id
                   where qt.conversation_id = t.conversation_id and qt.seq < t.seq
                     and q.status in ('queued', 'waiting_to_retry', 'running'))))
         order by c.available_at, c.created_at
         for update of c skip locked
         limit 1)
      returning e.*`,
    [owner, String(leaseMs)],
  );
  return result.rows[0] ? mapExecution(result.rows[0]) : null;
}

/** Extend the lease. False means this worker no longer holds the execution and must stop writing. */
export async function extendLease(db: Queryable, id: string, owner: string, leaseMs: number): Promise<boolean> {
  const result = await db.query(
    `update executions set lease_expires_at = now() + ($3 || ' milliseconds')::interval
      where id = $1 and lease_owner = $2 and status = 'running'`,
    [id, owner, String(leaseMs)],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function holdsLease(db: Queryable, id: string, owner: string): Promise<boolean> {
  const result = await db.query(
    "select 1 from executions where id = $1 and lease_owner = $2 and status = 'running' and lease_expires_at >= now()",
    [id, owner],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Finish while holding the lease. Returns false if the lease was lost (a stale attempt must not overwrite). */
export async function finishExecution(
  db: Queryable,
  id: string,
  owner: string,
  outcome: { status: "succeeded" | "failed" | "cancelled"; errorCode?: string; errorMessage?: string },
): Promise<boolean> {
  const result = await db.query(
    `update executions set status = $3, error_code = $4, error_message = $5, finished_at = now(),
            lease_owner = null, lease_expires_at = null
      where id = $1 and lease_owner = $2 and status = 'running'`,
    [id, owner, outcome.status, outcome.errorCode ?? null, outcome.errorMessage ?? null],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Hand the execution back for another attempt after a delay. */
export async function scheduleRetry(
  db: Queryable,
  id: string,
  owner: string,
  delayMs: number,
  error: { code: string; message: string },
): Promise<boolean> {
  const result = await db.query(
    `update executions set status = 'waiting_to_retry', available_at = now() + ($3 || ' milliseconds')::interval,
            error_code = $4, error_message = $5, lease_owner = null, lease_expires_at = null
      where id = $1 and lease_owner = $2 and status = 'running'`,
    [id, owner, String(delayMs), error.code, error.message],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Cooperative cancel: a queued run stops immediately, a running one stops before its next step. */
export async function requestCancel(db: Queryable, agencyId: string, executionId: string): Promise<string | null> {
  const queued = await db.query(
    `update executions set status = 'cancelled', cancel_requested = true, finished_at = now()
      where id = $1 and agency_id = $2 and status in ('queued', 'waiting_to_retry') returning turn_id`,
    [executionId, agencyId],
  );
  if (queued.rows[0]) {
    await db.query("update turns set status = 'cancelled', completed_at = now() where id = $1", [queued.rows[0].turn_id]);
    return "cancelled";
  }
  const running = await db.query(
    "update executions set cancel_requested = true where id = $1 and agency_id = $2 and status = 'running' returning id",
    [executionId, agencyId],
  );
  return running.rows[0] ? "cancelling" : null;
}

export async function isCancelRequested(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query("select cancel_requested from executions where id = $1", [id]);
  return result.rows[0]?.cancel_requested === true;
}

export async function getExecution(db: Queryable, agencyId: string, executionId: string): Promise<ExecutionRecord | null> {
  const result = await db.query("select * from executions where id = $1 and agency_id = $2", [executionId, agencyId]);
  return result.rows[0] ? mapExecution(result.rows[0]) : null;
}

export async function setExecutionSnapshot(
  db: Queryable,
  id: string,
  snapshot: { routingVersion: string; routingSnapshot: unknown; inputSnapshot: unknown },
): Promise<void> {
  await db.query("update executions set routing_version = $2, routing_snapshot = $3, input_snapshot = $4 where id = $1", [
    id, snapshot.routingVersion, JSON.stringify(snapshot.routingSnapshot), JSON.stringify(snapshot.inputSnapshot),
  ]);
}

export interface EventRow {
  id: number;
  kind: string;
  name: string;
  payload: unknown;
  payloadTruncated: boolean;
  durationMs: number | null;
  createdAt: Date;
}

export async function insertEvent(
  db: Queryable,
  executionId: string,
  event: { kind: string; name: string; payload?: unknown; truncated?: boolean; durationMs?: number },
): Promise<number> {
  const result = await db.query(
    `insert into execution_events (execution_id, kind, name, payload, payload_truncated, duration_ms)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [executionId, event.kind, event.name, event.payload === undefined ? null : JSON.stringify(event.payload), event.truncated ?? false, event.durationMs ?? null],
  );
  return Number(result.rows[0].id);
}

/** Events after a cursor, scoped to the agency, so the browser only fetches what is new. */
export async function listEvents(db: Queryable, agencyId: string, executionId: string, afterId: number, limit = 200): Promise<EventRow[]> {
  const result = await db.query(
    `select v.id, v.kind, v.name, v.payload, v.payload_truncated, v.duration_ms, v.created_at
       from execution_events v join executions e on e.id = v.execution_id
      where e.id = $1 and e.agency_id = $2 and v.id > $3 order by v.id limit $4`,
    [executionId, agencyId, afterId, limit],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    name: row.name,
    payload: row.payload,
    payloadTruncated: row.payload_truncated,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }));
}

export interface ModelCallInput {
  executionId: string;
  task: string;
  attempt: number;
  requestedModel: string;
  actualModel?: string | null;
  provider?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
  payloadTruncated?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  costEstimated?: boolean;
  error?: string | null;
}

export async function insertModelCall(db: Queryable, call: ModelCallInput): Promise<string> {
  const result = await db.query(
    `insert into model_calls (execution_id, task, attempt, requested_model, actual_model, provider, request_payload,
                              response_payload, payload_truncated, input_tokens, output_tokens, duration_ms, cost_usd,
                              cost_estimated, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [
      call.executionId, call.task, call.attempt, call.requestedModel, call.actualModel ?? null, call.provider ?? null,
      call.requestPayload === undefined ? null : JSON.stringify(call.requestPayload),
      call.responsePayload === undefined ? null : JSON.stringify(call.responsePayload),
      call.payloadTruncated ?? false, call.inputTokens ?? null, call.outputTokens ?? null, call.durationMs ?? null,
      call.costUsd ?? null, call.costEstimated ?? false, call.error ?? null,
    ],
  );
  return result.rows[0].id;
}

/** Atomically reserve tokens against the agency budget. False means the budget would be exceeded. */
export async function reserveTokens(db: Queryable, agencyId: string, tokens: number): Promise<boolean> {
  const result = await db.query(
    `update agencies set tokens_reserved = tokens_reserved + $2
      where id = $1 and tokens_spent + tokens_reserved + $2 <= token_budget`,
    [agencyId, tokens],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Replace a reservation with what was actually used. */
export async function settleTokens(db: Queryable, agencyId: string, reserved: number, spent: number): Promise<void> {
  await db.query(
    `update agencies set tokens_reserved = greatest(0, tokens_reserved - $2), tokens_spent = tokens_spent + $3 where id = $1`,
    [agencyId, reserved, spent],
  );
}
