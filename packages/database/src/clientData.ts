import type { CampaignRow } from "@exhibit/contracts";
import { mapCampaignRow, type CreativeReferenceRecord } from "./intelligence.js";
import type { Queryable } from "./transaction.js";

// A client's own workspace may use that client's own data. These queries are for single-client work only;
// cross-client work must go through the intelligence permission filter instead.

export interface ClientProfile {
  id: string;
  slug: string;
  name: string;
  category: string;
  brandVoice: string;
  audience: string;
  goals: string;
  constraints: string;
  standingInstructions: string;
}

export async function loadClientProfile(db: Queryable, agencyId: string, clientId: string): Promise<ClientProfile | null> {
  const result = await db.query(
    `select id, slug, name, category, brand_voice, audience, goals, constraints, standing_instructions
       from clients where id = $1 and agency_id = $2`,
    [clientId, agencyId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id, slug: row.slug, name: row.name, category: row.category, brandVoice: row.brand_voice,
        audience: row.audience, goals: row.goals, constraints: row.constraints, standingInstructions: row.standing_instructions,
      }
    : null;
}

/** The client's stored campaign data. Rows that came from turn attachments are parsed on demand instead. */
export async function loadClientCampaignRows(db: Queryable, agencyId: string, clientId: string): Promise<CampaignRow[]> {
  const result = await db.query(
    `select r.*, to_char(r.start_date, 'YYYY-MM-DD') as start_text, to_char(r.end_date, 'YYYY-MM-DD') as end_text
       from campaign_rows r join sources s on s.id = r.source_id
      where r.agency_id = $1 and r.client_id = $2 and s.kind = 'campaign_data'
      order by r.end_date, r.campaign_id`,
    [agencyId, clientId],
  );
  return result.rows.map(mapCampaignRow);
}

export async function loadClientCreativeReferences(db: Queryable, agencyId: string, clientId: string): Promise<CreativeReferenceRecord[]> {
  const result = await db.query(
    `select ref_id, campaign_id, title, description, visual_style, storytelling_approach, format, asset_note,
            (image_blob_id is not null) as has_image
       from creative_references where agency_id = $1 and client_id = $2 order by ref_id`,
    [agencyId, clientId],
  );
  return result.rows.map((row) => ({
    refId: row.ref_id, campaignId: row.campaign_id, title: row.title, description: row.description,
    visualStyle: row.visual_style, storytellingApproach: row.storytelling_approach, format: row.format,
    assetNote: row.asset_note, hasImage: row.has_image,
  }));
}

export interface SourceInfo {
  id: string;
  clientId: string | null;
  kind: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  text: string | null;
}

/** Sources visible to a client's conversation: that client's own files. Text is loaded only on request. */
export async function loadClientSources(db: Queryable, agencyId: string, clientId: string): Promise<Omit<SourceInfo, "text">[]> {
  const result = await db.query(
    `select id, client_id, kind, name, mime_type, size_bytes, status from sources
      where agency_id = $1 and client_id = $2 order by kind, name`,
    [agencyId, clientId],
  );
  return result.rows.map((row) => ({
    id: row.id, clientId: row.client_id, kind: row.kind, name: row.name, mimeType: row.mime_type, sizeBytes: row.size_bytes, status: row.status,
  }));
}

/** One source including its extracted text, only if it belongs to this client in this agency. */
export async function loadClientSource(db: Queryable, agencyId: string, clientId: string, sourceId: string): Promise<SourceInfo | null> {
  const result = await db.query(
    `select id, client_id, kind, name, mime_type, size_bytes, status, extracted_text from sources
      where id = $1 and agency_id = $2 and client_id = $3`,
    [sourceId, agencyId, clientId],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, clientId: row.client_id, kind: row.kind, name: row.name, mimeType: row.mime_type, sizeBytes: row.size_bytes, status: row.status, text: row.extracted_text }
    : null;
}

/** Validate attachments before a turn is accepted: every ID must be one of this client's sources. */
export async function validateClientAttachments(db: Queryable, agencyId: string, clientId: string, sourceIds: string[]): Promise<boolean> {
  if (sourceIds.length === 0) return true;
  const unique = [...new Set(sourceIds)];
  const result = await db.query(
    "select count(*)::int as n from sources where agency_id = $1 and client_id = $2 and id = any($3) and status = 'ready'",
    [agencyId, clientId, unique],
  );
  return result.rows[0].n === unique.length;
}
