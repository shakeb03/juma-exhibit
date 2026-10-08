import type { QueryResultRow } from "pg";
import type { Block, CommentStatus } from "@exhibit/contracts";
import { appendVersion, getVersion } from "./artifacts.js";
import type { Database } from "./pool.js";
import { withTransaction, type Queryable } from "./transaction.js";

export const MAX_ACTIVE_COMMENTS = 20;

export interface CommentRecord {
  id: string;
  artifactId: string;
  versionId: string;
  blockId: string;
  selection: string | null;
  body: string;
  status: CommentStatus;
  proposal: { block?: Block; summary?: string; claims?: { verified: number; total: number }; warnings?: unknown[]; error?: string } | null;
  resultingVersionId: string | null;
  executionId: string | null;
  createdAt: Date;
}

const mapComment = (row: QueryResultRow): CommentRecord => ({
  id: row.id, artifactId: row.artifact_id, versionId: row.version_id, blockId: row.block_id,
  selection: row.selection?.text ?? null, body: row.body, status: row.status, proposal: row.proposal,
  resultingVersionId: row.resulting_version_id, executionId: row.execution_id ?? null, createdAt: row.created_at,
});

const WITH_EXECUTION = `(select e.id from executions e where e.comment_id = c.id order by e.created_at desc limit 1) as execution_id`;

export class TooManyCommentsError extends Error {}

/** Save a comment on one block of one version and queue the run that proposes an edit. */
export async function createComment(
  db: Database,
  input: { agencyId: string; sessionId: string; versionId: string; blockId: string; body: string; selection?: string; backendCommit: string | null },
): Promise<{ comment: CommentRecord } | { error: "version_not_found" | "block_not_found" }> {
  return withTransaction(db, async (tx) => {
    const version = await getVersion(tx, input.agencyId, input.versionId);
    if (!version) return { error: "version_not_found" as const };
    if (!version.blocks.some((b) => b.id === input.blockId)) return { error: "block_not_found" as const };
    const active = await tx.query("select count(*)::int as n from comments where artifact_id = $1 and status in ('open', 'proposed')", [version.artifactId]);
    if (active.rows[0].n >= MAX_ACTIVE_COMMENTS) throw new TooManyCommentsError();
    const inserted = await tx.query(
      `insert into comments (agency_id, artifact_id, version_id, block_id, selection, body, author_session_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [input.agencyId, version.artifactId, input.versionId, input.blockId, input.selection ? JSON.stringify({ text: input.selection }) : null, input.body, input.sessionId],
    );
    await tx.query(
      "insert into executions (agency_id, kind, comment_id, backend_commit) values ($1, 'comment_edit', $2, $3)",
      [input.agencyId, inserted.rows[0].id, input.backendCommit],
    );
    const row = await tx.query(`select c.*, ${WITH_EXECUTION} from comments c where c.id = $1`, [inserted.rows[0].id]);
    return { comment: mapComment(row.rows[0]) };
  });
}

export async function listComments(db: Queryable, agencyId: string, artifactId: string): Promise<CommentRecord[]> {
  const result = await db.query(
    `select c.*, ${WITH_EXECUTION} from comments c where c.agency_id = $1 and c.artifact_id = $2 order by c.created_at`,
    [agencyId, artifactId],
  );
  return result.rows.map(mapComment);
}

export async function getComment(db: Queryable, agencyId: string, commentId: string): Promise<CommentRecord | null> {
  const result = await db.query(`select c.*, ${WITH_EXECUTION} from comments c where c.id = $1 and c.agency_id = $2`, [commentId, agencyId]);
  return result.rows[0] ? mapComment(result.rows[0]) : null;
}

/** What the run needs: the comment, the version it was written on, and the block it targets. */
export async function loadCommentTarget(db: Queryable, agencyId: string, commentId: string) {
  const comment = await getComment(db, agencyId, commentId);
  if (!comment) return null;
  const version = await getVersion(db, agencyId, comment.versionId);
  if (!version) return null;
  const block = version.blocks.find((b) => b.id === comment.blockId);
  return block ? { comment, version, block } : null;
}

/** Store the proposal, but only while this worker still holds the run and the comment is still waiting for it. */
export async function commitProposal(
  db: Database,
  input: { executionId: string; owner: string; commentId: string; proposal: NonNullable<CommentRecord["proposal"]> },
): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const lease = await tx.query(
      "select 1 from executions where id = $1 and lease_owner = $2 and status = 'running' and lease_expires_at >= now() for update",
      [input.executionId, input.owner],
    );
    if (lease.rowCount === 0) return false;
    const updated = await tx.query(
      "update comments set status = 'proposed', proposal = $2 where id = $1 and status = 'open'",
      [input.commentId, JSON.stringify(input.proposal)],
    );
    return updated.rowCount === 1;
  });
}

export async function failComment(db: Queryable, commentId: string, message: string): Promise<void> {
  await db.query("update comments set status = 'failed', proposal = $2 where id = $1 and status = 'open'", [commentId, JSON.stringify({ error: message })]);
}

export async function rejectComment(db: Queryable, agencyId: string, commentId: string): Promise<CommentRecord | null | "not_allowed"> {
  const result = await db.query(
    `update comments set status = 'rejected' where id = $1 and agency_id = $2 and status in ('proposed', 'stale', 'failed') returning id`,
    [commentId, agencyId],
  );
  if (result.rows[0]) return getComment(db, agencyId, commentId);
  return (await getComment(db, agencyId, commentId)) ? "not_allowed" : null;
}

/** Ask for a fresh proposal, for a comment that failed or whose block changed underneath it. */
export async function retryComment(db: Database, agencyId: string, commentId: string, backendCommit: string | null): Promise<CommentRecord | null | "not_allowed"> {
  return withTransaction(db, async (tx) => {
    const found = await tx.query("select status from comments where id = $1 and agency_id = $2 for update", [commentId, agencyId]);
    if (!found.rows[0]) return null;
    if (!["stale", "failed", "proposed"].includes(found.rows[0].status)) return "not_allowed" as const;
    await tx.query("update comments set status = 'open', proposal = null where id = $1", [commentId]);
    await tx.query("insert into executions (agency_id, kind, comment_id, backend_commit) values ($1, 'comment_edit', $2, $3)", [agencyId, commentId, backendCommit]);
    return getComment(tx, agencyId, commentId);
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type AcceptOutcome =
  | { ok: true; versionId: string; version: number }
  | { ok: false; reason: "not_found" | "not_proposed" | "stale" | "rejected"; message?: string };

/**
 * Accept a proposal as a new version in which the commented block is the only difference. If the block has changed
 * since the comment was written the proposal no longer applies, so the comment is marked stale instead.
 */
export async function acceptComment(db: Database, agencyId: string, commentId: string): Promise<AcceptOutcome> {
  return withTransaction(db, async (tx) => {
    const found = await tx.query("select * from comments where id = $1 and agency_id = $2 for update", [commentId, agencyId]);
    const comment = found.rows[0];
    if (!comment) return { ok: false as const, reason: "not_found" as const };
    if (comment.status !== "proposed" || !comment.proposal?.block) return { ok: false as const, reason: "not_proposed" as const };
    const proposed = comment.proposal.block as Block;

    const artifact = await tx.query("select current_version_id from artifacts where id = $1", [comment.artifact_id]);
    const written = await tx.query("select blocks from artifact_versions where id = $1", [comment.version_id]);
    const originalBlock = (written.rows[0].blocks as Block[]).find((b) => b.id === comment.block_id);

    let outcome: AcceptOutcome | null = null;
    const appended = await appendVersion(tx, {
      agencyId, artifactId: comment.artifact_id, baseVersionId: artifact.rows[0].current_version_id,
      cause: { kind: "comment", commentId },
      build: (base) => {
        const currentBlock = base.blocks.find((b) => b.id === comment.block_id);
        // Rebase onto the latest version only when the block itself is untouched since the comment was written.
        if (!currentBlock || !originalBlock || !sameJson(currentBlock, originalBlock)) {
          outcome = { ok: false, reason: "stale" };
          return { error: "stale" };
        }
        const blocks = base.blocks.map((b) => (b.id === comment.block_id ? proposed : b));
        // The server, not the model, guarantees nothing else moved.
        const others = (list: Block[]) => list.filter((b) => b.id !== comment.block_id);
        if (proposed.id !== comment.block_id || proposed.type !== currentBlock.type || !sameJson(others(blocks), others(base.blocks)) || blocks.length !== base.blocks.length) {
          outcome = { ok: false, reason: "rejected", message: "The proposal changed more than the commented block." };
          return { error: "rejected" };
        }
        return { blocks, edit: { commentId, blockId: comment.block_id, before: currentBlock, after: proposed } };
      },
    });
    if (!appended.ok) {
      if (outcome) {
        if ((outcome as AcceptOutcome & { ok: false }).reason === "stale") await tx.query("update comments set status = 'stale' where id = $1", [commentId]);
        return outcome;
      }
      return { ok: false as const, reason: "not_found" as const };
    }
    await tx.query("update comments set status = 'accepted', resulting_version_id = $2 where id = $1", [commentId, appended.versionId]);
    return { ok: true as const, versionId: appended.versionId, version: appended.version };
  });
}
