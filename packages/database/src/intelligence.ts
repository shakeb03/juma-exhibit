import type { CampaignRow, CanvasEdge, CanvasNode } from "@exhibit/contracts";
import type { Queryable } from "./transaction.js";

// Every query here is scoped by agency_id, and the data queries repeat the sharing flag in SQL.
// The code that calls them also checks the flag; this is a second, independent barrier.

export interface ClientPermissions {
  id: string;
  slug: string;
  name: string;
  sharePerformance: boolean;
  shareCreative: boolean;
  permissionVersion: number;
}

export async function loadClientPermissions(db: Queryable, agencyId: string, clientIds: string[]): Promise<ClientPermissions[]> {
  if (clientIds.length === 0) return [];
  const result = await db.query(
    `select id, slug, name, share_performance, share_creative, permission_version
       from clients where agency_id = $1 and id = any($2) order by slug`,
    [agencyId, clientIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    sharePerformance: row.share_performance,
    shareCreative: row.share_creative,
    permissionVersion: row.permission_version,
  }));
}

const num = (value: string | number | null): number | null => (value === null ? null : Number(value));

/**
 * Campaign rows from the client's own campaign data, only when performance patterns are approved.
 * Rows that arrived as turn attachments (kind 'attachment') are never part of intelligence.
 */
export async function loadApprovedCampaignRows(db: Queryable, agencyId: string, clientId: string): Promise<CampaignRow[]> {
  const result = await db.query(
    `select r.*, to_char(r.start_date, 'YYYY-MM-DD') as start_text, to_char(r.end_date, 'YYYY-MM-DD') as end_text
       from campaign_rows r
       join sources s on s.id = r.source_id and s.agency_id = r.agency_id
       join clients c on c.id = r.client_id and c.agency_id = r.agency_id
      where r.agency_id = $1 and r.client_id = $2 and s.kind = 'campaign_data' and c.share_performance = true
      order by r.end_date, r.campaign_id`,
    [agencyId, clientId],
  );
  return result.rows.map((row) => ({
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    channel: row.channel,
    period: row.period,
    startDate: row.start_text,
    endDate: row.end_text,
    currency: row.currency,
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    conversions: num(row.conversions),
    revenue: num(row.revenue),
    attributionWindow: row.attribution_window,
    creativeRefId: row.creative_ref_id,
  }));
}

export interface CreativeReferenceRecord {
  refId: string;
  campaignId: string | null;
  title: string;
  description: string;
  visualStyle: string;
  storytellingApproach: string;
  format: string;
  assetNote: string;
  hasImage: boolean;
}

/** Creative references, only when creative assets are approved. */
export async function loadApprovedCreativeReferences(db: Queryable, agencyId: string, clientId: string): Promise<CreativeReferenceRecord[]> {
  const result = await db.query(
    `select x.ref_id, x.campaign_id, x.title, x.description, x.visual_style, x.storytelling_approach, x.format, x.asset_note,
            (x.image_blob_id is not null) as has_image
       from creative_references x
       join clients c on c.id = x.client_id and c.agency_id = x.agency_id
      where x.agency_id = $1 and x.client_id = $2 and c.share_creative = true
      order by x.ref_id`,
    [agencyId, clientId],
  );
  return result.rows.map((row) => ({
    refId: row.ref_id,
    campaignId: row.campaign_id,
    title: row.title,
    description: row.description,
    visualStyle: row.visual_style,
    storytellingApproach: row.storytelling_approach,
    format: row.format,
    assetNote: row.asset_note,
    hasImage: row.has_image,
  }));
}

export interface CanvasSourceRecord {
  id: string;
  clientId: string | null;
  kind: string;
  name: string;
  sizeBytes: number;
  version: number;
  text: string | null;
}

/** Sources referenced by canvas nodes. Ownership of each source is judged by the caller. */
export async function loadCanvasSources(db: Queryable, agencyId: string, sourceIds: string[]): Promise<CanvasSourceRecord[]> {
  if (sourceIds.length === 0) return [];
  const result = await db.query(
    `select id, client_id, kind, name, size_bytes, version, extracted_text
       from sources where agency_id = $1 and id = any($2)`,
    [agencyId, sourceIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    kind: row.kind,
    name: row.name,
    sizeBytes: row.size_bytes,
    version: row.version,
    text: row.extracted_text,
  }));
}

/** Load one immutable canvas revision, only if the canvas belongs to the agency. */
export async function loadCanvasRevision(
  db: Queryable,
  agencyId: string,
  canvasId: string,
  revision: number,
): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] } | null> {
  const result = await db.query(
    `select r.nodes, r.edges
       from canvas_revisions r join canvases c on c.id = r.canvas_id
      where c.agency_id = $1 and c.id = $2 and r.revision = $3`,
    [agencyId, canvasId, revision],
  );
  const row = result.rows[0];
  return row ? { nodes: row.nodes, edges: row.edges } : null;
}

/**
 * Change a client's sharing flags. The permission version only moves when something actually
 * changed, so results built on older permissions can be detected and invalidated.
 */
export async function setClientSharing(
  db: Queryable,
  agencyId: string,
  clientId: string,
  flags: { performancePatterns: boolean; creativeAssets: boolean },
): Promise<ClientPermissions | null> {
  const result = await db.query(
    `update clients
        set share_performance = $3,
            share_creative = $4,
            permission_version = permission_version
              + case when share_performance <> $3 or share_creative <> $4 then 1 else 0 end
      where agency_id = $1 and id = $2
      returning id, slug, name, share_performance, share_creative, permission_version`,
    [agencyId, clientId, flags.performancePatterns, flags.creativeAssets],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id, slug: row.slug, name: row.name,
        sharePerformance: row.share_performance, shareCreative: row.share_creative, permissionVersion: row.permission_version,
      }
    : null;
}
