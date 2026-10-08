import type { ArtifactKind, Block } from "@exhibit/contracts";
import { getArtifact, getVersion, latestArtifactForConversation, type Queryable } from "@exhibit/database";
import type { RegistryMetric, RegistryScope } from "./registry.js";

export interface BaseArtifact {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  versionId: string;
  version: number;
  blocks: Block[];
  metrics: Record<string, RegistryMetric>;
  scopes: RegistryScope[];
}

/**
 * The artifact a request is about: the version the user was looking at, otherwise the latest in the conversation.
 * Returns null when there is none, or when the referenced version belongs to a different conversation.
 */
export async function loadBaseArtifact(
  db: Queryable,
  agencyId: string,
  conversationId: string,
  referencedVersionId: string | null,
): Promise<BaseArtifact | null> {
  let versionId = referencedVersionId;
  if (!versionId) versionId = (await latestArtifactForConversation(db, agencyId, conversationId))?.currentVersionId ?? null;
  if (!versionId) return null;
  const version = await getVersion(db, agencyId, versionId);
  if (!version || version.conversationId !== conversationId) return null;
  const artifact = await getArtifact(db, agencyId, version.artifactId);
  if (!artifact) return null;
  const evidence = version.evidence as { metrics?: Record<string, RegistryMetric>; scopes?: RegistryScope[] };
  return {
    artifactId: artifact.id, kind: artifact.kind as ArtifactKind, title: artifact.title, versionId: version.id, version: version.version,
    blocks: version.blocks, metrics: evidence.metrics ?? {}, scopes: evidence.scopes ?? [],
  };
}
