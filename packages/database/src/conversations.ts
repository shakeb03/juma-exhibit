import type { QueryResultRow } from "pg";
import type { TurnSummary } from "@exhibit/contracts";
import { withTransaction } from "./transaction.js";
import type { Database } from "./pool.js";
import type { Queryable } from "./transaction.js";

/** One conversation per client. Created on first use. */
export async function getOrCreateClientConversation(db: Queryable, agencyId: string, clientId: string): Promise<string | null> {
  const client = await db.query("select 1 from clients where id = $1 and agency_id = $2", [clientId, agencyId]);
  if (client.rowCount === 0) return null;
  await db.query(
    `insert into conversations (agency_id, kind, client_id) values ($1, 'client', $2)
     on conflict (client_id) where kind = 'client' do nothing`,
    [agencyId, clientId],
  );
  const result = await db.query("select id from conversations where agency_id = $1 and kind = 'client' and client_id = $2", [agencyId, clientId]);
  return result.rows[0].id;
}

export interface SubmittedTurn {
  turnId: string;
  executionId: string;
  seq: number;
  duplicate: boolean;
}

export const MAX_PENDING_TURNS = 3;

export class TooManyPendingTurnsError extends Error {
  constructor() {
    super("Too many requests are still running in this conversation.");
    this.name = "TooManyPendingTurnsError";
  }
}

/**
 * Save a turn and queue its execution in one transaction. The idempotency key makes a retried
 * submission return the original turn instead of creating a second one.
 */
export async function submitTurn(
  db: Database,
  input: {
    agencyId: string;
    conversationId: string;
    idempotencyKey: string;
    userMessage: string;
    attachmentSourceIds: string[];
    referencedVersionId?: string;
    canvasRevision?: number;
    backendCommit: string | null;
  },
): Promise<SubmittedTurn> {
  return withTransaction(db, async (tx) => {
    // Serialize submissions per conversation so sequence numbers never collide.
    await tx.query("select id from conversations where id = $1 and agency_id = $2 for update", [input.conversationId, input.agencyId]);

    const existing = await tx.query(
      `select t.id, t.seq, (select e.id from executions e where e.turn_id = t.id order by e.created_at limit 1) as execution_id
         from turns t where t.conversation_id = $1 and t.idempotency_key = $2`,
      [input.conversationId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return { turnId: existing.rows[0].id, executionId: existing.rows[0].execution_id, seq: existing.rows[0].seq, duplicate: true };
    }

    const pending = await tx.query(
      "select count(*)::int as n from turns where conversation_id = $1 and status in ('queued', 'running')",
      [input.conversationId],
    );
    if (pending.rows[0].n >= MAX_PENDING_TURNS) throw new TooManyPendingTurnsError();

    const next = await tx.query("select coalesce(max(seq), 0) + 1 as seq from turns where conversation_id = $1", [input.conversationId]);
    const seq: number = next.rows[0].seq;
    const turn = await tx.query(
      `insert into turns (conversation_id, agency_id, seq, idempotency_key, user_message, attachment_source_ids, referenced_version_id, canvas_revision)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [input.conversationId, input.agencyId, seq, input.idempotencyKey, input.userMessage, input.attachmentSourceIds, input.referencedVersionId ?? null, input.canvasRevision ?? null],
    );
    const execution = await tx.query(
      `insert into executions (agency_id, kind, turn_id, backend_commit) values ($1, 'turn', $2, $3) returning id`,
      [input.agencyId, turn.rows[0].id, input.backendCommit],
    );
    return { turnId: turn.rows[0].id, executionId: execution.rows[0].id, seq, duplicate: false };
  });
}

export interface StoredTurn {
  id: string;
  conversationId: string;
  agencyId: string;
  seq: number;
  userMessage: string;
  attachmentSourceIds: string[];
  referencedVersionId: string | null;
  canvasRevision: number | null;
  status: string;
  replyKind: string | null;
  replyMessage: string | null;
  replyData: unknown;
  createdAt: Date;
}

const mapTurn = (row: QueryResultRow): StoredTurn => ({
  id: row.id,
  conversationId: row.conversation_id,
  agencyId: row.agency_id,
  seq: row.seq,
  userMessage: row.user_message,
  attachmentSourceIds: row.attachment_source_ids,
  referencedVersionId: row.referenced_version_id,
  canvasRevision: row.canvas_revision,
  status: row.status,
  replyKind: row.reply_kind,
  replyMessage: row.reply_message,
  replyData: row.reply_data,
  createdAt: row.created_at,
});

export async function getTurn(db: Queryable, agencyId: string, turnId: string): Promise<StoredTurn | null> {
  const result = await db.query("select * from turns where id = $1 and agency_id = $2", [turnId, agencyId]);
  return result.rows[0] ? mapTurn(result.rows[0]) : null;
}

/** Turns for a conversation, oldest first, with the execution and artifact version each one produced. */
export async function listTurns(
  db: Queryable,
  agencyId: string,
  conversationId: string,
): Promise<(StoredTurn & { executionId: string | null; artifact: TurnSummary["artifact"] })[]> {
  const result = await db.query(
    `select t.*,
            (select e.id from executions e where e.turn_id = t.id order by e.created_at limit 1) as execution_id,
            v.id as version_id, v.version, v.artifact_id
       from turns t
       left join artifact_versions v on v.cause_turn_id = t.id
      where t.conversation_id = $1 and t.agency_id = $2
      order by t.seq`,
    [conversationId, agencyId],
  );
  return result.rows.map((row) => ({
    ...mapTurn(row),
    executionId: row.execution_id,
    artifact: row.version_id ? { artifactId: row.artifact_id, versionId: row.version_id, version: row.version } : null,
  }));
}

/** Recent finished turns, newest last, used as conversation history for the model. */
export async function recentTurns(db: Queryable, conversationId: string, beforeSeq: number, limit: number): Promise<StoredTurn[]> {
  const result = await db.query(
    `select * from (
       select * from turns where conversation_id = $1 and seq < $2 and status = 'succeeded' order by seq desc limit $3
     ) x order by seq`,
    [conversationId, beforeSeq, limit],
  );
  return result.rows.map(mapTurn);
}

export async function conversationAgency(db: Queryable, agencyId: string, conversationId: string) {
  const result = await db.query(
    "select id, kind, client_id, canvas_id, chat_node_id from conversations where id = $1 and agency_id = $2",
    [conversationId, agencyId],
  );
  const row = result.rows[0];
  return row ? { id: row.id as string, kind: row.kind as string, clientId: row.client_id as string | null } : null;
}
