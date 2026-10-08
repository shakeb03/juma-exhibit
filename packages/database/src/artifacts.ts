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
            exists (select 1 from approvals p where p.artifact_version_id = v.id) as approved
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
    createdAt: row.created_at as Date,
  }));
}
