import type { QueryResultRow } from "pg";
import type { Block } from "@exhibit/contracts";
import type { Queryable } from "./transaction.js";

export interface ArtifactRecord {
  id: string;
  conversationId: string;
  kind: string;
  title: string;
  currentVersionId: string | null;
}

export interface ArtifactVersionRecord {
  id: string;
  artifactId: string;
  version: number;
  blocks: Block[];
  evidence: Record<string, unknown>;
  checks: Record<string, unknown>;
  causeKind: string;
  causeTurnId: string | null;
  baseVersionId: string | null;
  createdAt: Date;
}

const mapVersion = (row: QueryResultRow): ArtifactVersionRecord => ({
  id: row.id,
  artifactId: row.artifact_id,
  version: row.version,
  blocks: row.blocks,
  evidence: row.evidence,
  checks: row.checks,
  causeKind: row.cause_kind,
  causeTurnId: row.cause_turn_id,
  baseVersionId: row.base_version_id,
  createdAt: row.created_at,
});

export async function getVersion(db: Queryable, agencyId: string, versionId: string): Promise<(ArtifactVersionRecord & { conversationId: string; kind: string }) | null> {
  const result = await db.query(
    `select v.*, a.conversation_id, a.kind from artifact_versions v join artifacts a on a.id = v.artifact_id
      where v.id = $1 and a.agency_id = $2`,
    [versionId, agencyId],
  );
  const row = result.rows[0];
  return row ? { ...mapVersion(row), conversationId: row.conversation_id, kind: row.kind } : null;
}

export async function getArtifact(db: Queryable, agencyId: string, artifactId: string): Promise<ArtifactRecord | null> {
  const result = await db.query("select * from artifacts where id = $1 and agency_id = $2", [artifactId, agencyId]);
  const row = result.rows[0];
  return row
    ? { id: row.id, conversationId: row.conversation_id, kind: row.kind, title: row.title, currentVersionId: row.current_version_id }
    : null;
}

/** The artifact currently open in a conversation: the most recently updated one. */
export async function latestArtifactForConversation(db: Queryable, agencyId: string, conversationId: string) {
  const result = await db.query(
    `select a.id, a.kind, a.title, a.current_version_id, v.version
       from artifacts a join artifact_versions v on v.id = a.current_version_id
      where a.agency_id = $1 and a.conversation_id = $2 order by v.created_at desc limit 1`,
    [agencyId, conversationId],
  );
  const row = result.rows[0];
  return row ? { id: row.id as string, kind: row.kind as string, title: row.title as string, currentVersionId: row.current_version_id as string, version: row.version as number } : null;
}

export async function listVersions(db: Queryable, agencyId: string, artifactId: string) {
  const result = await db.query(
    `select v.id, v.version, v.cause_kind, v.cause_turn_id, v.created_at,
            exists (select 1 from approvals p where p.artifact_version_id = v.id) as approved,
            (select p.approved_at from approvals p where p.artifact_version_id = v.id) as approved_at
       from artifact_versions v join artifacts a on a.id = v.artifact_id
      where a.id = $1 and a.agency_id = $2 order by v.version`,
    [artifactId, agencyId],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    version: row.version as number,
    causeKind: row.cause_kind as string,
    causeTurnId: row.cause_turn_id as string | null,
    approved: row.approved as boolean,
    approvedAt: (row.approved_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  }));
}

export interface ApprovalRecord { versionId: string; approvedAt: Date }

/** Approve exactly one version. Approving again is a no-op that returns the original approval. */
export async function approveVersion(db: Queryable, agencyId: string, versionId: string, sessionId: string): Promise<ApprovalRecord | null> {
  const version = await getVersion(db, agencyId, versionId);
  if (!version) return null;
  const result = await db.query(
    `insert into approvals (artifact_version_id, session_id) values ($1, $2)
       on conflict (artifact_version_id) do update set artifact_version_id = excluded.artifact_version_id
     returning artifact_version_id, approved_at`,
    [versionId, sessionId],
  );
  return { versionId: result.rows[0].artifact_version_id, approvedAt: result.rows[0].approved_at };
}

export async function getApproval(db: Queryable, agencyId: string, versionId: string): Promise<ApprovalRecord | null> {
  const result = await db.query(
    `select p.artifact_version_id, p.approved_at from approvals p
       join artifact_versions v on v.id = p.artifact_version_id join artifacts a on a.id = v.artifact_id
      where p.artifact_version_id = $1 and a.agency_id = $2`,
    [versionId, agencyId],
  );
  const row = result.rows[0];
  return row ? { versionId: row.artifact_version_id, approvedAt: row.approved_at } : null;
}

export interface ExportRecord {
  id: string;
  versionId: string;
  label: "Draft" | "Approved";
  status: "queued" | "succeeded" | "failed";
  checksum: string | null;
  error: string | null;
  createdAt: Date;
}

const mapExport = (row: QueryResultRow): ExportRecord => ({
  id: row.id, versionId: row.artifact_version_id, label: row.label, status: row.status,
  checksum: row.checksum, error: row.error, createdAt: row.created_at,
});

/** The export row for a version and label, created if missing. A retry reuses the same row. */
export async function ensureExport(db: Queryable, agencyId: string, versionId: string, label: "Draft" | "Approved"): Promise<ExportRecord> {
  const result = await db.query(
    `insert into exports (agency_id, artifact_version_id, label) values ($1, $2, $3)
       on conflict (artifact_version_id, label) do update set label = excluded.label
     returning *`,
    [agencyId, versionId, label],
  );
  return mapExport(result.rows[0]);
}

export async function completeExport(db: Queryable, agencyId: string, exportId: string, file: { data: Buffer; sha256: string }): Promise<void> {
  const blob = await db.query(
    `insert into file_blobs (agency_id, mime_type, size_bytes, sha256, data) values ($1, 'application/pdf', $2, $3, $4) returning id`,
    [agencyId, file.data.length, file.sha256, file.data],
  );
  await db.query(
    "update exports set status = 'succeeded', blob_id = $3, checksum = $4, error = null where id = $1 and agency_id = $2",
    [exportId, agencyId, blob.rows[0].id, file.sha256],
  );
}

export async function failExport(db: Queryable, agencyId: string, exportId: string, error: string): Promise<void> {
  await db.query("update exports set status = 'failed', error = $3 where id = $1 and agency_id = $2", [exportId, agencyId, error]);
}

export async function getExportFile(db: Queryable, agencyId: string, exportId: string) {
  const result = await db.query(
    `select e.label, a.title, v.version, b.data from exports e
       join artifact_versions v on v.id = e.artifact_version_id join artifacts a on a.id = v.artifact_id
       join file_blobs b on b.id = e.blob_id
      where e.id = $1 and e.agency_id = $2 and e.status = 'succeeded'`,
    [exportId, agencyId],
  );
  const row = result.rows[0];
  return row ? { label: row.label as string, title: row.title as string, version: row.version as number, data: row.data as Buffer } : null;
}

export async function listExports(db: Queryable, agencyId: string, versionId: string): Promise<ExportRecord[]> {
  const result = await db.query(
    "select * from exports where agency_id = $1 and artifact_version_id = $2 and status = 'succeeded' order by created_at",
    [agencyId, versionId],
  );
  return result.rows.map(mapExport);
}
