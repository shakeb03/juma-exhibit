import { createHash } from "node:crypto";
import type { Block, ArtifactKind } from "@exhibit/contracts";
import { withTransaction, type Database } from "@exhibit/database";
import { LeaseLostError } from "../exec/errors.js";
import type { Claims } from "./validate.js";
import type { RegistryMetric, RegistryScope } from "./registry.js";

export interface ArtifactCommit {
  action: "create" | "update";
  kind: ArtifactKind;
  title: string;
  blocks: Block[];
  /** The artifact being revised, for updates. */
  targetArtifactId?: string;
  baseVersionId?: string;
}

export interface TurnCommit {
  executionId: string;
  owner: string;
  turnId: string;
  conversationId: string;
  agencyId: string;
  replyKind: "answer" | "clarification";
  replyMessage: string;
  replyData: Record<string, unknown>;
  artifact?: ArtifactCommit;
  evidence?: { metrics: Record<string, RegistryMetric>; scopes: RegistryScope[]; claims: Claims; warnings: unknown[] };
  sourceFingerprint: string;
}

export interface CommittedArtifact {
  artifactId: string;
  versionId: string;
  version: number;
}

/**
 * Save the outcome of a turn: reply, optional artifact version, and the turn status, in one transaction.
 * The execution row is locked first and must still be leased to this worker, so a stale attempt that lost
 * its lease cannot overwrite anything.
 */
export async function commitTurn(db: Database, commit: TurnCommit): Promise<CommittedArtifact | null> {
  return withTransaction(db, async (tx) => {
    const lease = await tx.query(
      "select 1 from executions where id = $1 and lease_owner = $2 and status = 'running' and lease_expires_at >= now() for update",
      [commit.executionId, commit.owner],
    );
    if (lease.rowCount === 0) throw new LeaseLostError();

    let committed: CommittedArtifact | null = null;
    if (commit.artifact) {
      const draft = commit.artifact;
      let artifactId: string;
      let version = 1;
      if (draft.action === "update") {
        if (!draft.targetArtifactId) throw new Error("Update requested without a target artifact.");
        const locked = await tx.query("select id from artifacts where id = $1 and agency_id = $2 for update", [draft.targetArtifactId, commit.agencyId]);
        if (!locked.rows[0]) throw new Error("The artifact to update no longer exists.");
        artifactId = locked.rows[0].id;
        const next = await tx.query("select coalesce(max(version), 0) + 1 as v from artifact_versions where artifact_id = $1", [artifactId]);
        version = next.rows[0].v;
        await tx.query("update artifacts set title = $2 where id = $1", [artifactId, draft.title]);
      } else {
        const created = await tx.query(
          "insert into artifacts (agency_id, conversation_id, kind, title) values ($1, $2, $3, $4) returning id",
          [commit.agencyId, commit.conversationId, draft.kind, draft.title],
        );
        artifactId = created.rows[0].id;
      }
      const evidence = commit.evidence ?? { metrics: {}, scopes: [], claims: { verified: 0, total: 0 }, warnings: [] };
      const inserted = await tx.query(
        `insert into artifact_versions (artifact_id, version, blocks, evidence, checks, cause_kind, cause_turn_id, base_version_id, source_fingerprint)
         values ($1, $2, $3, $4, $5, 'turn', $6, $7, $8) returning id`,
        [
          artifactId, version, JSON.stringify(draft.blocks),
          JSON.stringify({ metrics: evidence.metrics, scopes: evidence.scopes }),
          JSON.stringify({ claims: evidence.claims, warnings: evidence.warnings }),
          commit.turnId, draft.baseVersionId ?? null, commit.sourceFingerprint,
        ],
      );
      await tx.query("update artifacts set current_version_id = $2 where id = $1", [artifactId, inserted.rows[0].id]);
      committed = { artifactId, versionId: inserted.rows[0].id, version };
    }

    await tx.query(
      `update turns set status = 'succeeded', reply_kind = $2, reply_message = $3, reply_data = $4, completed_at = now() where id = $1`,
      [commit.turnId, commit.replyKind, commit.replyMessage, JSON.stringify({ ...commit.replyData, artifact: committed })],
    );
    return committed;
  });
}

/** Mark a turn failed or cancelled with an honest message. Existing artifacts are untouched. */
export async function failTurn(db: Database, turnId: string, status: "failed" | "cancelled", message: string): Promise<void> {
  await db.query(
    `update turns set status = $2, reply_kind = $3, reply_message = $4, completed_at = now() where id = $1 and status in ('queued', 'running')`,
    [turnId, status, status === "failed" ? "failure" : null, message],
  );
}

export const fingerprint = (parts: unknown) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
