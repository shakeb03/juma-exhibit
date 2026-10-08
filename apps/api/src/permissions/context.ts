import { createHash } from "node:crypto";
import { canvasEdgeSchema, canvasNodeSchema, type CampaignRow, type CanvasEdge, type CanvasNode } from "@exhibit/contracts";
import {
  loadApprovedCampaignRows, loadApprovedCreativeReferences, loadCanvasSources, loadClientPermissions,
  type ClientPermissions, type CreativeReferenceRecord, type Queryable,
} from "@exhibit/database";
import { calculateMetrics } from "../metrics/calculate.js";
import {
  CanvasError, ContextLimitError, SHARED_METRICS, type CampaignPattern, type ClientContext, type CreativeEntry,
  type Exclusion, type ExplicitContext, type IntelligenceContext, type NormalizedMetrics, type PatternGroup,
} from "./types.js";

/** Total explicit text (briefs, references, ideas) and the size of any imported file. */
export const MAX_EXPLICIT_CHARS = 12_000;
export const MAX_EXPLICIT_SOURCE_BYTES = 12 * 1024;

/** Source kinds a canvas node may bring in as explicit context. Client-owned sources are never in this list. */
const EXPLICIT_SOURCE_KINDS = new Set(["new_client_brief", "reference"]);

function band(value: number | null, edges: number[], labels: string[]): string {
  if (value === null) return "unavailable";
  const index = edges.findIndex((edge) => value < edge);
  return labels[index === -1 ? labels.length - 1 : index]!;
}
export const impressionsBand = (n: number | null) =>
  band(n, [250_000, 1_000_000, 2_500_000], ["under 250k", "250k to 1M", "1M to 2.5M", "over 2.5M"]);
export const spendBand = (n: number | null) =>
  band(n, [5_000, 10_000, 20_000], ["under 5k", "5k to 10k", "10k to 20k", "over 20k"]);

function normalize(scope: string, rows: CampaignRow[]) {
  const set = calculateMetrics(scope, rows);
  const values = {} as NormalizedMetrics["values"];
  const unavailable: NormalizedMetrics["unavailable"] = {};
  for (const name of SHARED_METRICS) {
    const metric = set.metrics[name];
    values[name] = metric.value;
    if (metric.value === null && metric.unavailableReason) unavailable[name] = metric.unavailableReason;
  }
  return { metrics: { values, unavailable } satisfies NormalizedMetrics, warnings: set.warnings };
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildGroups(
  slug: string,
  rows: CampaignRow[],
  creativeByCampaign: Map<string, CreativeReferenceRecord>,
  pick: (ref: CreativeReferenceRecord) => string,
): PatternGroup[] {
  const groups = new Map<string, CampaignRow[]>();
  for (const row of rows) {
    const ref = creativeByCampaign.get(row.campaignId);
    if (!ref) continue; // campaigns without creative information cannot be grouped
    const key = pick(ref);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([value, members]) => {
    const overall = normalize(`${slug}:${value}`, members);
    const channels = [...new Set(members.map((row) => row.channel))].sort();
    return {
      value,
      campaigns: members.length,
      refs: members.map((row) => `${slug}:${row.campaignId}`),
      overall: overall.metrics,
      byChannel: channels.map((channel) => {
        const subset = members.filter((row) => row.channel === channel);
        return { channel, campaigns: subset.length, metrics: normalize(`${slug}:${value}:${channel}`, subset).metrics };
      }),
      warnings: overall.warnings,
    };
  });
}

async function buildClientContext(db: Queryable, agencyId: string, perms: ClientPermissions): Promise<ClientContext> {
  const context: ClientContext = {
    clientId: perms.id,
    slug: perms.slug,
    name: perms.name,
    performanceApproved: perms.sharePerformance,
    creativeApproved: perms.shareCreative,
    campaigns: [],
    creativeReferences: [],
    patterns: { visualStyle: [], storytelling: [] },
  };

  // Each loader repeats the approval in SQL, so a mistake here still cannot widen access.
  const rows = perms.sharePerformance ? await loadApprovedCampaignRows(db, agencyId, perms.id) : [];
  const creative = perms.shareCreative ? await loadApprovedCreativeReferences(db, agencyId, perms.id) : [];
  const creativeByCampaign = new Map(creative.filter((c) => c.campaignId).map((c) => [c.campaignId!, c]));

  context.creativeReferences = creative.map(
    (c): CreativeEntry => ({
      ref: `${perms.slug}:creative:${c.refId}`,
      refId: c.refId,
      campaignId: c.campaignId,
      title: c.title,
      description: c.description,
      visualStyle: c.visualStyle,
      storytelling: c.storytellingApproach,
      format: c.format,
      assetNote: c.assetNote,
    }),
  );

  context.campaigns = rows.map((row): CampaignPattern => {
    const creativeRef = creativeByCampaign.get(row.campaignId);
    return {
      ref: `${perms.slug}:${row.campaignId}`,
      campaignId: row.campaignId,
      channel: row.channel,
      period: row.period,
      attributionWindow: row.attributionWindow,
      currency: row.currency,
      scale: { impressionsBand: impressionsBand(row.impressions), spendBand: spendBand(row.spend) },
      metrics: normalize(row.campaignId, [row]).metrics,
      ...(creativeRef
        ? { creative: { ref: `${perms.slug}:creative:${creativeRef.refId}`, visualStyle: creativeRef.visualStyle, storytelling: creativeRef.storytellingApproach, format: creativeRef.format } }
        : {}),
    };
  });

  if (perms.sharePerformance && perms.shareCreative) {
    context.patterns = {
      visualStyle: buildGroups(perms.slug, rows, creativeByCampaign, (r) => r.visualStyle),
      storytelling: buildGroups(perms.slug, rows, creativeByCampaign, (r) => r.storytellingApproach),
    };
  }
  return context;
}

export interface BuildOptions {
  agencyId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  chatNodeId: string;
}

/**
 * Build everything a chat node is allowed to know. This is the only door to cross-client data:
 * model prompts and tools receive this object and nothing else.
 *
 * - Connections only select candidates. Sharing flags decide what each client contributes.
 * - Performance becomes normalized rates and grouped patterns; raw totals, audiences, private briefs,
 *   previous work, and turn attachments are never included.
 * - Briefs, references, and ideas on the canvas are explicit context, but client-owned sources are refused.
 */
export async function buildIntelligenceContext(db: Queryable, options: BuildOptions): Promise<IntelligenceContext> {
  const { agencyId, chatNodeId } = options;
  const nodes = options.nodes.map((node) => canvasNodeSchema.parse(node));
  const edges = options.edges.map((edge) => canvasEdgeSchema.parse(edge));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const chat = byId.get(chatNodeId);
  if (!chat || chat.type !== "chat") throw new CanvasError("chat_node_missing", "The chat node is not on this canvas.");

  const connectedIds = new Set<string>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) throw new CanvasError("invalid_canvas", "A connection points at a node that does not exist.");
    if (edge.source === chatNodeId) connectedIds.add(edge.target);
    if (edge.target === chatNodeId) connectedIds.add(edge.source);
  }
  const connected = [...connectedIds].map((id) => byId.get(id)!).filter((node) => node.type !== "chat");

  const exclusions: Exclusion[] = [];

  // Clients: connection selects, flags decide.
  const clientNodes = connected.filter((node) => node.type === "client" && node.clientId);
  const requestedClientIds = [...new Set(clientNodes.map((node) => node.clientId!))];
  const permissions = await loadClientPermissions(db, agencyId, requestedClientIds);
  const found = new Set(permissions.map((p) => p.id));
  for (const id of requestedClientIds.filter((id) => !found.has(id))) {
    exclusions.push({ subject: `client ${id}`, category: "node", reason: "Client not found in this workspace." });
  }

  const clients: ClientContext[] = [];
  for (const perms of permissions) {
    if (!perms.sharePerformance) {
      exclusions.push({ subject: perms.name, category: "performance_patterns", reason: "Not approved for cross-client intelligence." });
    }
    if (!perms.shareCreative) {
      exclusions.push({ subject: perms.name, category: "creative_assets", reason: "Creative assets are not approved for cross-client intelligence." });
    }
    clients.push(await buildClientContext(db, agencyId, perms));
  }

  // Explicit canvas context: new-client briefs, references, ideas.
  const explicit: ExplicitContext[] = [];
  const sourceNodes = connected.filter((node) => (node.type === "brief" || node.type === "reference") && node.sourceId);
  const sources = await loadCanvasSources(db, agencyId, [...new Set(sourceNodes.map((node) => node.sourceId!))]);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const usedSources: { id: string; version: number }[] = [];

  for (const node of sourceNodes) {
    const source = sourceById.get(node.sourceId!);
    const subject = node.title ?? node.id;
    if (!source) {
      exclusions.push({ subject, category: "source", reason: "Source not found in this workspace." });
      continue;
    }
    // A client's own files are only reachable through that client's approvals, never by dropping them on the canvas.
    if (source.clientId !== null || !EXPLICIT_SOURCE_KINDS.has(source.kind)) {
      exclusions.push({ subject: source.name, category: "source", reason: "Client-owned files cannot be added to the canvas directly." });
      continue;
    }
    if (source.sizeBytes > MAX_EXPLICIT_SOURCE_BYTES) {
      throw new ContextLimitError("source_too_large", `${source.name} is ${source.sizeBytes} bytes; canvas files are limited to ${MAX_EXPLICIT_SOURCE_BYTES} bytes.`);
    }
    if (!source.text) {
      exclusions.push({ subject: source.name, category: "source", reason: "No readable text." });
      continue;
    }
    explicit.push({ ref: `canvas:${node.type}:${node.id}`, kind: node.type as "brief" | "reference", title: source.name, text: source.text });
    usedSources.push({ id: source.id, version: source.version });
  }
  // Ideas, and any brief or reference typed or pasted straight onto the canvas, are explicit context.
  for (const node of connected.filter((n) => n.text && (n.type === "idea" || ((n.type === "brief" || n.type === "reference") && !n.sourceId)))) {
    const kind = node.type as "idea" | "brief" | "reference";
    explicit.push({ ref: `canvas:${kind}:${node.id}`, kind, title: node.title ?? (kind === "idea" ? "Idea" : kind === "brief" ? "New-client brief" : "Reference"), text: node.text! });
  }

  const totalChars = explicit.reduce((sum, item) => sum + item.text.length, 0);
  if (totalChars > MAX_EXPLICIT_CHARS) {
    // Never truncate silently: the user must shorten or remove something.
    throw new ContextLimitError("context_too_large", `Canvas context is ${totalChars} characters; the limit is ${MAX_EXPLICIT_CHARS}.`);
  }

  const refs = [
    ...clients.flatMap((c) => [...c.campaigns.map((x) => x.ref), ...c.creativeReferences.map((x) => x.ref)]),
    ...explicit.map((e) => e.ref),
  ];

  return {
    chatNodeId,
    connectedNodeIds: connected.map((node) => node.id),
    clients,
    explicit,
    exclusions,
    refs,
    permissionFingerprint: sha256(
      permissions.map((p) => [p.id, p.permissionVersion, p.sharePerformance, p.shareCreative]),
    ),
    sourceFingerprint: sha256([usedSources.sort((a, b) => a.id.localeCompare(b.id)), explicit.map((e) => e.text)]),
  };
}

/** The exact payload that goes into a model prompt. Internal fingerprints stay out. */
export function toModelContext(context: IntelligenceContext) {
  return {
    clients: context.clients.map((client) => ({
      name: client.name,
      slug: client.slug,
      performanceApproved: client.performanceApproved,
      creativeApproved: client.creativeApproved,
      campaigns: client.campaigns,
      creativeReferences: client.creativeReferences,
      patterns: client.patterns,
    })),
    explicitContext: context.explicit,
    notAvailable: context.exclusions,
    citableRefs: context.refs,
  };
}

/** Citations that do not resolve to an approved record. Used to reject invalid model output. */
export function unresolvedRefs(context: IntelligenceContext, cited: string[]): string[] {
  const allowed = new Set(context.refs);
  return cited.filter((ref) => !allowed.has(ref));
}

/**
 * Re-resolve the same canvas against current permissions and sources. Returns the reasons it changed,
 * or an empty list when still current. Call before analysis, before commit, and before serving results.
 */
export async function contextChanges(db: Queryable, previous: IntelligenceContext, options: BuildOptions): Promise<string[]> {
  const now = await buildIntelligenceContext(db, options);
  const reasons: string[] = [];
  if (now.permissionFingerprint !== previous.permissionFingerprint) reasons.push("Sharing permissions changed.");
  if (now.sourceFingerprint !== previous.sourceFingerprint) reasons.push("Source content changed.");
  return reasons;
}
