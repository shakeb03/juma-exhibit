import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canvasEdgeSchema, canvasNodeSchema, sourceKindSchema, type CanvasEdge, type CanvasNode } from "@exhibit/contracts";
import { insertMany, type Queryable } from "@exhibit/database";
import { parseBrandContext } from "../ingest/brand.js";
import { parseCreativeReferencesCsv } from "../ingest/creative.js";
import { parseCampaignCsv } from "../metrics/csv.js";

const manifestSchema = z.object({
  clients: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      category: z.string(),
      sharing: z.object({ performancePatterns: z.boolean(), creativeAssets: z.boolean() }),
      files: z.array(z.object({ path: z.string(), kind: sourceKindSchema })),
    }),
  ),
  newClientBriefs: z.array(z.object({ slug: z.string(), name: z.string(), path: z.string() })),
  challengeFiles: z.array(z.object({ path: z.string(), client: z.string().optional(), tests: z.string() })),
});
type Manifest = z.infer<typeof manifestSchema>;

interface FixtureFile {
  path: string;
  kind: z.infer<typeof sourceKindSchema>;
  clientSlug: string | null;
}

const mimeFor = (path: string) => (path.endsWith(".csv") ? "text/csv" : "text/markdown");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export interface SeedSummary {
  clients: number;
  sources: number;
  campaignRows: number;
  creativeReferences: number;
}

function filesFromManifest(manifest: Manifest): FixtureFile[] {
  return [
    ...manifest.clients.flatMap((client) => client.files.map((file) => ({ ...file, clientSlug: client.slug }))),
    ...manifest.newClientBriefs.map((brief) => ({ path: brief.path, kind: "new_client_brief" as const, clientSlug: null })),
    ...manifest.challengeFiles.map((file) => ({ path: file.path, kind: "attachment" as const, clientSlug: file.client ?? null })),
  ];
}

/**
 * Ensure fixture bytes exist once, shared and immutable. Visitors reference them through their own
 * source rows; a checksum or blob ID never grants access by itself.
 */
async function ensureFixtureBlobs(
  db: Queryable,
  fixturesDir: string,
  files: FixtureFile[],
): Promise<Map<string, { id: string; size: number }>> {
  const loaded = new Map(files.map((file) => [file.path, readFileSync(join(fixturesDir, file.path))]));
  const keys = [...loaded.keys()];
  const existing = await db.query("select fixture_key, id from file_blobs where fixture_key = any($1)", [keys]);
  const known = new Map<string, string>(existing.rows.map((row: { fixture_key: string; id: string }) => [row.fixture_key, row.id]));

  const missing = keys.filter((key) => !known.has(key));
  if (missing.length > 0) {
    const rows = missing.map((key) => {
      const data = loaded.get(key)!;
      return [key, mimeFor(key), data.length, sha256(data), data];
    });
    // Concurrent visitors may race to insert; the unique key makes the loser a no-op.
    for (const row of rows) {
      await db.query(
        `insert into file_blobs (fixture_key, mime_type, size_bytes, sha256, data)
         values ($1, $2, $3, $4, $5) on conflict (fixture_key) where fixture_key is not null do nothing`,
        row,
      );
    }
    const again = await db.query("select fixture_key, id from file_blobs where fixture_key = any($1)", [missing]);
    for (const row of again.rows) known.set(row.fixture_key, row.id);
  }
  return new Map(keys.map((key) => [key, { id: known.get(key)!, size: loaded.get(key)!.length }]));
}

/**
 * Populate one agency from the fictional fixtures. Run inside the caller's transaction so a
 * failed seed leaves no half-built agency behind.
 */
export async function seedAgency(db: Queryable, agencyId: string, fixturesDir: string): Promise<SeedSummary> {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(fixturesDir, "manifest.json"), "utf8")));
  const files = filesFromManifest(manifest);
  const blobs = await ensureFixtureBlobs(db, fixturesDir, files);
  const text = (path: string) => readFileSync(join(fixturesDir, path), "utf8");

  // Clients, with brand context parsed from each brand.md.
  const clientRows = manifest.clients.map((client) => {
    const brandFile = client.files.find((file) => file.kind === "brand_context");
    const brand = parseBrandContext(brandFile ? text(brandFile.path) : "");
    return [
      agencyId, client.slug, client.name, client.category,
      brand.brandVoice, brand.audience, brand.goals, brand.constraints, brand.standingInstructions,
      client.sharing.performancePatterns, client.sharing.creativeAssets,
    ];
  });
  const insertedClients = await insertMany(
    db, "clients",
    ["agency_id", "slug", "name", "category", "brand_voice", "audience", "goals", "constraints", "standing_instructions", "share_performance", "share_creative"],
    clientRows, "id, slug",
  );
  const clientIdBySlug = new Map(insertedClients.map((row) => [row.slug as string, row.id as string]));

  // One source row per file; all text fixtures are immediately ready with extracted text.
  const sourceRows = files.map((file) => {
    const blob = blobs.get(file.path)!;
    return [
      agencyId, file.clientSlug ? clientIdBySlug.get(file.clientSlug)! : null, file.kind,
      file.path.split("/").pop()!, blob.id, mimeFor(file.path), blob.size, "ready", text(file.path), file.path,
    ];
  });
  const insertedSources = await insertMany(
    db, "sources",
    ["agency_id", "client_id", "kind", "name", "blob_id", "mime_type", "size_bytes", "status", "extracted_text", "fixture_path"],
    sourceRows, "id, fixture_path",
  );
  const sourceIdByPath = new Map(insertedSources.map((row) => [row.fixture_path as string, row.id as string]));

  // Structured rows from campaign data and creative references. Challenge attachments stay unparsed
  // until a user attaches them to a turn.
  let campaignCount = 0;
  let creativeCount = 0;
  for (const client of manifest.clients) {
    const clientId = clientIdBySlug.get(client.slug)!;
    for (const file of client.files) {
      const sourceId = sourceIdByPath.get(file.path)!;
      if (file.kind === "campaign_data") {
        const parsed = parseCampaignCsv(text(file.path));
        if (parsed.issues.length > 0) throw new Error(`Fixture ${file.path} has invalid rows: ${JSON.stringify(parsed.issues)}`);
        const rows = parsed.rows.map((r) => [
          agencyId, clientId, sourceId, r.campaignId, r.campaignName, r.channel, r.period, r.startDate, r.endDate,
          r.currency, r.spend, r.impressions, r.clicks, r.conversions, r.revenue, r.attributionWindow, r.creativeRefId,
        ]);
        await insertMany(
          db, "campaign_rows",
          ["agency_id", "client_id", "source_id", "campaign_id", "campaign_name", "channel", "period", "start_date", "end_date",
           "currency", "spend", "impressions", "clicks", "conversions", "revenue", "attribution_window", "creative_ref_id"],
          rows,
        );
        campaignCount += rows.length;
      }
      if (file.kind === "creative_references") {
        const rows = parseCreativeReferencesCsv(text(file.path)).map((r) => [
          agencyId, clientId, sourceId, r.refId, r.campaignId, r.title, r.description,
          r.visualStyle, r.storytellingApproach, r.format, r.assetNote,
        ]);
        await insertMany(
          db, "creative_references",
          ["agency_id", "client_id", "source_id", "ref_id", "campaign_id", "title", "description", "visual_style", "storytelling_approach", "format", "asset_note"],
          rows,
        );
        creativeCount += rows.length;
      }
    }
  }

  // Starting canvas: nodes placed but not connected. Connecting is the user's decision.
  const nodes: CanvasNode[] = [
    ...manifest.clients.map((client, index) =>
      canvasNodeSchema.parse({ id: `client-${client.slug}`, type: "client", position: { x: 80, y: 60 + index * 200 }, clientId: clientIdBySlug.get(client.slug) }),
    ),
    ...manifest.newClientBriefs.map((brief) =>
      canvasNodeSchema.parse({ id: `brief-${brief.slug}`, type: "brief", position: { x: 80, y: 700 }, sourceId: sourceIdByPath.get(brief.path), title: brief.name }),
    ),
    canvasNodeSchema.parse({ id: "chat-1", type: "chat", position: { x: 560, y: 260 }, title: "Chat" }),
  ];
  const edges: CanvasEdge[] = [];
  edges.forEach((edge) => canvasEdgeSchema.parse(edge));
  const canvas = await db.query("insert into canvases (agency_id, nodes, edges) values ($1, $2, $3) returning id", [
    agencyId, JSON.stringify(nodes), JSON.stringify(edges),
  ]);
  await db.query("insert into canvas_revisions (canvas_id, revision, nodes, edges) values ($1, 1, $2, $3)", [
    canvas.rows[0].id, JSON.stringify(nodes), JSON.stringify(edges),
  ]);

  return { clients: insertedClients.length, sources: insertedSources.length, campaignRows: campaignCount, creativeReferences: creativeCount };
}
