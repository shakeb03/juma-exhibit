import type { ClientSummary, SourceSummary } from "@exhibit/contracts";
import type { Queryable } from "./transaction.js";

/** Always scoped to the agency from the session; callers never pass an agency ID from a request. */
export async function listClients(db: Queryable, agencyId: string): Promise<ClientSummary[]> {
  const result = await db.query(
    `select c.id, c.slug, c.name, c.category, c.share_performance, c.share_creative, c.permission_version,
            (select count(*)::int from sources s where s.client_id = c.id) as sources,
            (select count(*)::int from campaign_rows r where r.client_id = c.id) as campaigns,
            (select count(*)::int from creative_references x where x.client_id = c.id) as creative_references
       from clients c
      where c.agency_id = $1
      order by c.name`,
    [agencyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    sharing: { performancePatterns: row.share_performance, creativeAssets: row.share_creative },
    permissionVersion: row.permission_version,
    counts: { sources: row.sources, campaigns: row.campaigns, creativeReferences: row.creative_references },
  }));
}

/** Metadata only. The blob column is never selected here. */
export async function listSources(db: Queryable, agencyId: string): Promise<SourceSummary[]> {
  const result = await db.query(
    `select id, client_id, kind, name, mime_type, size_bytes, status
       from sources
      where agency_id = $1
      order by client_id nulls last, kind, name`,
    [agencyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
  }));
}
