import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "@exhibit/contracts";
import { createPool, loadCanvasRevision, setClientSharing, type Database } from "@exhibit/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { SESSION_COOKIE } from "../session/plugin.js";
import {
  MAX_EXPLICIT_CHARS, buildIntelligenceContext, contextChanges, toModelContext, unresolvedRefs, type BuildOptions,
} from "./context.js";
import { CanvasError, ContextLimitError, type IntelligenceContext } from "./types.js";

// Runs against the real Neon database. Every agency created here is deleted afterwards.
const config = loadConfig();
const secret = { "x-proxy-secret": config.proxySecret };
const key = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/evaluations/answer-key.json"), "utf8"),
);

let db: Database;
let app: FastifyInstance;
const created: string[] = [];
let ipCounter = 100;

interface World {
  agencyId: string;
  cookie: string;
  csrf: string;
  client: Record<string, string>; // slug -> id
  source: Record<string, string>; // fixture file name -> id
  nodes: CanvasNode[];
}

async function newWorld(): Promise<World> {
  const res = await app.inject({
    method: "POST", url: "/v1/session", payload: {},
    headers: { ...secret, "x-client-ip": `203.0.113.${ipCounter++}` },
  });
  const agencyId = res.json().agencyId as string;
  created.push(agencyId);
  const clients = await db.query("select id, slug from clients where agency_id = $1", [agencyId]);
  const sources = await db.query("select id, name from sources where agency_id = $1", [agencyId]);
  const canvas = await db.query("select nodes from canvases where agency_id = $1", [agencyId]);
  return {
    agencyId,
    cookie: `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`,
    csrf: res.json().csrfToken,
    client: Object.fromEntries(clients.rows.map((r) => [r.slug, r.id])),
    source: Object.fromEntries(sources.rows.map((r) => [r.name, r.id])),
    nodes: canvas.rows[0].nodes,
  };
}

const edge = (from: string, to = "chat-1"): CanvasEdge => ({ id: `${from}->${to}`, source: from, target: to });
const options = (w: World, connect: string[], extraNodes: CanvasNode[] = [], extraEdges: CanvasEdge[] = []): BuildOptions => ({
  agencyId: w.agencyId,
  nodes: [...w.nodes, ...extraNodes],
  edges: [...connect.map((id) => edge(id)), ...extraEdges],
  chatNodeId: "chat-1",
});
const RL = "client-ridgeline-outfitters";
const MF = "client-marlowe-finch";
const VS = "client-velvet-static";
const TW = "brief-tidewell-swim";

const modelJson = (ctx: IntelligenceContext) => JSON.stringify(toModelContext(ctx));
const slugs = (ctx: IntelligenceContext) => ctx.clients.map((c) => c.slug).sort();
const find = (ctx: IntelligenceContext, slug: string) => ctx.clients.find((c) => c.slug === slug)!;

/** Every object key anywhere in the value. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

beforeAll(() => {
  db = createPool({ connectionString: config.databaseUrl, max: 3 });
  app = buildApp(config, { pingDatabase: async () => {}, db, sessionConfig: config, logger: false });
});
afterAll(async () => {
  if (created.length) await db.query("delete from agencies where id = any($1)", [created]);
  await db.end();
});

describe("what a chat node may see", () => {
  it("combines two approved clients and an explicit new-client brief", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [RL, MF, TW]));
    expect(slugs(ctx)).toEqual(["marlowe-finch", "ridgeline-outfitters"]);
    expect(find(ctx, "ridgeline-outfitters").campaigns).toHaveLength(7);
    expect(find(ctx, "marlowe-finch").creativeReferences).toHaveLength(6);
    expect(ctx.explicit.map((e) => e.title)).toEqual(["brief.md"]);
    expect(ctx.explicit[0]!.text).toMatch(/Tidewell Swim/);
    expect(ctx.exclusions).toEqual([]);
  });

  it("only exposes normalized rates: no raw totals, audiences, or private client text", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [RL, MF, TW]));
    const keys = allKeys(toModelContext(ctx));
    for (const forbidden of ["spend", "impressions", "clicks", "conversions", "revenue", "audience", "brandVoice", "constraints", "goals", "standingInstructions", "campaignName"]) {
      expect(keys.has(forbidden), `key ${forbidden}`).toBe(false);
    }
    const text = modelJson(ctx);
    const privateStrings = [
      "product recall", "30 USD", "Dana", "28 to 45", "technical jacket", // Ridgeline brief and brand
      "Elise", "Wholesale", "35 to 60", "shirtmaker", "320,000", // Marlowe & Finch brief and brand
      "1300000", "33800", "12600.00", "11400", "2200000", // raw totals from Ridgeline's data
      "Basecamp Stories", "Founder Letter", // campaign names
      "monthly report", "Previous work", // previous work
    ];
    for (const s of privateStrings) expect(text, s).not.toContain(s);
  });

  it("computes pattern numbers in code that match the independent answer key", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [RL, MF]));
    const bold = find(ctx, "ridgeline-outfitters").patterns.visualStyle.find((g) => g.value === "bold-on-location")!;
    const wantBold = key.clients["ridgeline-outfitters"].byVisualStyle["bold-on-location"];
    expect(bold.overall.values.ctr).toBeCloseTo(wantBold.ctr, 5);
    expect(bold.overall.values.conversionsPer1kImpressions).toBeCloseTo(wantBold.conversionsPer1kImpressions, 5);
    const story = find(ctx, "marlowe-finch").patterns.storytelling.find((g) => g.value === "customer-story")!;
    expect(story.overall.values.conversionRate).toBeCloseTo(key.clients["marlowe-finch"].byStorytelling["customer-story"].conversionRate, 5);
    // The within-channel split is present so a channel effect is not mistaken for a creative effect.
    expect(bold.byChannel.map((c) => c.channel).sort()).toEqual(["Meta", "Pinterest"]);
    const pinBold = bold.byChannel.find((c) => c.channel === "Pinterest")!;
    expect(pinBold.metrics.values.ctr!).toBeGreaterThan(0.024);
    expect(find(ctx, "ridgeline-outfitters").campaigns[0]!.scale.spendBand).toMatch(/k/);
  });

  it("flags attribution differences between Meta rows for the limitations", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [MF, RL]));
    const windows = new Set(find(ctx, "marlowe-finch").campaigns.map((c) => c.attributionWindow));
    expect(windows).toEqual(new Set(["7d_click", "7d_click_1d_view"]));
    expect(find(ctx, "marlowe-finch").patterns.storytelling.some((g) => g.warnings.some((x) => /attribution/.test(x)))).toBe(true);
  });
});

describe("restricted clients contribute nothing", () => {
  const leaks = ["Mara Voss", "14 November", "countdown", "trade secret", "embargo", "neon", "Drop 04", "Drop 05", "8 USD", "12 USD", "Velvet Static's", "24000", "122400"];

  it("includes the restricted client only as a name with an explanation", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [RL, MF, VS, TW]));
    const velvet = find(ctx, "velvet-static");
    expect(velvet.performanceApproved).toBe(false);
    expect(velvet.creativeApproved).toBe(false);
    expect(velvet.campaigns).toEqual([]);
    expect(velvet.creativeReferences).toEqual([]);
    expect(velvet.patterns).toEqual({ visualStyle: [], storytelling: [] });
    expect(ctx.exclusions.filter((e) => e.subject === "Velvet Static").map((e) => e.category).sort()).toEqual(["creative_assets", "performance_patterns"]);
    expect(ctx.refs.some((r) => r.startsWith("velvet-static:"))).toBe(false);
    const text = modelJson(ctx);
    for (const leak of leaks) expect(text, leak).not.toContain(leak);
    // Exclusion notes never contain the excluded content.
    expect(JSON.stringify(ctx.exclusions)).not.toMatch(/countdown|Mara|neon/i);
  });

  it("does not grant access just because the node is connected", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [VS]));
    expect(find(ctx, "velvet-static").campaigns).toEqual([]);
    expect(ctx.refs).toEqual([]);
  });

  it("ignores client nodes that are on the canvas but not connected", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [TW]));
    expect(ctx.clients).toEqual([]);
    expect(ctx.connectedNodeIds).toEqual([TW]);
  });

  it("treats connections in either direction the same", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, { ...options(w, []), edges: [edge("chat-1", RL), edge(MF)] });
    expect(slugs(ctx)).toEqual(["marlowe-finch", "ridgeline-outfitters"]);
  });

  it("does not let a canvas reference pull in a client's private file", async () => {
    const w = await newWorld();
    const ref: CanvasNode = { id: "ref-sneaky", type: "reference", position: { x: 0, y: 0 }, sourceId: w.source["brief.md"], title: "sneaky" };
    const velvetBrief = await db.query("select id from sources where agency_id = $1 and client_id = $2 and kind = 'brief'", [w.agencyId, w.client["velvet-static"]]);
    ref.sourceId = velvetBrief.rows[0].id;
    const ctx = await buildIntelligenceContext(db, options(w, [RL, "ref-sneaky"], [ref]));
    expect(ctx.explicit).toEqual([]);
    expect(ctx.exclusions.some((e) => e.category === "source" && /Client-owned/.test(e.reason))).toBe(true);
    expect(modelJson(ctx)).not.toContain("Mara Voss");
  });

  it("cannot reach another visitor's source by guessing its ID", async () => {
    const a = await newWorld();
    const b = await newWorld();
    const foreign: CanvasNode = { id: "ref-foreign", type: "reference", position: { x: 0, y: 0 }, sourceId: b.source["brief.md"] };
    const bTidewell = await db.query("select id from sources where agency_id = $1 and kind = 'new_client_brief'", [b.agencyId]);
    foreign.sourceId = bTidewell.rows[0].id;
    const ctx = await buildIntelligenceContext(db, options(a, ["ref-foreign"], [foreign]));
    expect(ctx.explicit).toEqual([]);
    expect(ctx.exclusions[0]?.reason).toBe("Source not found in this workspace.");
  });

  it("cannot reach another visitor's client by guessing its ID", async () => {
    const a = await newWorld();
    const b = await newWorld();
    const foreign: CanvasNode = { id: "client-foreign", type: "client", position: { x: 0, y: 0 }, clientId: b.client["ridgeline-outfitters"] };
    const ctx = await buildIntelligenceContext(db, options(a, ["client-foreign"], [foreign]));
    expect(ctx.clients).toEqual([]);
    expect(ctx.exclusions[0]?.reason).toBe("Client not found in this workspace.");
  });

  it("keeps turn attachments out of intelligence even for an approved client", async () => {
    const w = await newWorld();
    const attachment = await db.query("select id from sources where agency_id = $1 and name = 'ridgeline-pinterest-partial-export.csv'", [w.agencyId]);
    await db.query(
      `insert into campaign_rows (agency_id, client_id, source_id, campaign_id, campaign_name, channel, period, start_date, end_date, currency, spend, impressions, clicks, attribution_window)
       values ($1, $2, $3, 'RL-PIN-1001', 'Winter Shell Preview', 'Pinterest', '2026-10', '2026-10-01', '2026-10-05', 'USD', 2100, 260000, 3380, '7d_click')`,
      [w.agencyId, w.client["ridgeline-outfitters"], attachment.rows[0].id],
    );
    const ctx = await buildIntelligenceContext(db, options(w, [RL]));
    expect(find(ctx, "ridgeline-outfitters").campaigns).toHaveLength(7);
    expect(ctx.refs).not.toContain("ridgeline-outfitters:RL-PIN-1001");
  });
});

describe("the two approvals are separate", () => {
  it("creative off, performance on: rates remain but no creative tags or patterns", async () => {
    const w = await newWorld();
    await setClientSharing(db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: true, creativeAssets: false });
    const ctx = await buildIntelligenceContext(db, options(w, [RL, MF, TW]));
    const mf = find(ctx, "marlowe-finch");
    expect(mf.campaigns).toHaveLength(7);
    expect(mf.campaigns.every((c) => c.creative === undefined)).toBe(true);
    expect(mf.creativeReferences).toEqual([]);
    expect(mf.patterns).toEqual({ visualStyle: [], storytelling: [] });
    expect(ctx.exclusions.some((e) => e.subject === "Marlowe & Finch" && e.category === "creative_assets")).toBe(true);
    // The other client is unaffected.
    expect(find(ctx, "ridgeline-outfitters").patterns.visualStyle.length).toBeGreaterThan(0);
    const text = modelJson(ctx);
    expect(text).not.toContain("handwritten note");
    expect(text).not.toContain("customer-story");
  });

  it("performance off, creative on: references remain but no metrics", async () => {
    const w = await newWorld();
    await setClientSharing(db, w.agencyId, w.client["velvet-static"]!, { performancePatterns: false, creativeAssets: true });
    const ctx = await buildIntelligenceContext(db, options(w, [VS]));
    const vs = find(ctx, "velvet-static");
    expect(vs.campaigns).toEqual([]);
    expect(vs.patterns).toEqual({ visualStyle: [], storytelling: [] });
    expect(vs.creativeReferences).toHaveLength(3);
    expect(JSON.stringify(toModelContext(ctx))).not.toMatch(/"ctr"|"roas"/);
  });

  it("both off: nothing from that client", async () => {
    const w = await newWorld();
    await setClientSharing(db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: false, creativeAssets: false });
    const ctx = await buildIntelligenceContext(db, options(w, [MF]));
    expect(find(ctx, "marlowe-finch").campaigns).toEqual([]);
    expect(find(ctx, "marlowe-finch").creativeReferences).toEqual([]);
    expect(ctx.refs).toEqual([]);
  });
});

describe("limits, citations, and staleness", () => {
  it("refuses over-long canvas context instead of truncating", async () => {
    const w = await newWorld();
    // A single idea is capped by the node schema; the total limit is reached with several.
    const ideas = (count: number, chars: number): CanvasNode[] =>
      Array.from({ length: count }, (_, i) => ({ id: `idea-${i}`, type: "idea" as const, position: { x: 0, y: 0 }, text: "x".repeat(chars) }));
    const connect = (nodes: CanvasNode[]) => options(w, nodes.map((n) => n.id), nodes);

    const tooLong = ideas(4, 3_001); // 12,004 characters
    await expect(buildIntelligenceContext(db, connect(tooLong))).rejects.toMatchObject({ code: "context_too_large" });

    const exact = ideas(3, 4_000); // exactly 12,000 characters
    const ok = await buildIntelligenceContext(db, connect(exact));
    expect(ok.explicit.reduce((n, e) => n + e.text.length, 0)).toBe(MAX_EXPLICIT_CHARS);

    await expect(buildIntelligenceContext(db, options(w, ["idea-0"], [{ ...ideas(1, 1)[0]!, text: "x".repeat(4_001) }]))).rejects.toThrow();
  });

  it("refuses an oversized imported file", async () => {
    const w = await newWorld();
    await db.query("update sources set size_bytes = 13000 where agency_id = $1 and kind = 'new_client_brief'", [w.agencyId]);
    const err = await buildIntelligenceContext(db, options(w, [TW])).catch((e) => e);
    expect(err).toBeInstanceOf(ContextLimitError);
    expect(err.code).toBe("source_too_large");
  });

  it("rejects a canvas with no chat node or a dangling connection", async () => {
    const w = await newWorld();
    await expect(buildIntelligenceContext(db, { ...options(w, [RL]), chatNodeId: "nope" })).rejects.toBeInstanceOf(CanvasError);
    await expect(buildIntelligenceContext(db, options(w, ["ghost"]))).rejects.toMatchObject({ code: "invalid_canvas" });
  });

  it("rejects citations that do not resolve to an approved record", async () => {
    const w = await newWorld();
    const ctx = await buildIntelligenceContext(db, options(w, [RL, MF, VS]));
    expect(unresolvedRefs(ctx, ["ridgeline-outfitters:RL-PIN-0901", "marlowe-finch:creative:MF-C03"])).toEqual([]);
    expect(unresolvedRefs(ctx, ["velvet-static:VS-MET-0901", "ridgeline-outfitters:RL-NOPE-1"])).toEqual([
      "velvet-static:VS-MET-0901",
      "ridgeline-outfitters:RL-NOPE-1",
    ]);
  });

  it("detects changed permissions and changed sources, and is stable otherwise", async () => {
    const w = await newWorld();
    const opts = options(w, [RL, MF, TW]);
    const first = await buildIntelligenceContext(db, opts);
    expect(await contextChanges(db, first, opts)).toEqual([]);

    await db.query("update sources set extracted_text = extracted_text || ' Added line.' where agency_id = $1 and kind = 'new_client_brief'", [w.agencyId]);
    expect(await contextChanges(db, first, opts)).toEqual(["Source content changed."]);

    const second = await buildIntelligenceContext(db, opts);
    await setClientSharing(db, w.agencyId, w.client["marlowe-finch"]!, { performancePatterns: true, creativeAssets: false });
    expect(await contextChanges(db, second, opts)).toEqual(["Sharing permissions changed."]);
  });

  it("loads a saved canvas revision only for its own agency", async () => {
    const a = await newWorld();
    const b = await newWorld();
    const canvasA = (await db.query("select id from canvases where agency_id = $1", [a.agencyId])).rows[0].id;
    expect((await loadCanvasRevision(db, a.agencyId, canvasA, 1))?.nodes).toHaveLength(5);
    expect(await loadCanvasRevision(db, b.agencyId, canvasA, 1)).toBeNull();
  });
});

describe("changing sharing through the API", () => {
  it("updates flags, bumps the permission version only on change, and requires CSRF", async () => {
    const w = await newWorld();
    const url = `/v1/clients/${w.client["marlowe-finch"]}/sharing`;
    const headers = { ...secret, cookie: w.cookie, "x-csrf-token": w.csrf };

    const noCsrf = await app.inject({ method: "PATCH", url, headers: { ...secret, cookie: w.cookie }, payload: { performancePatterns: true, creativeAssets: false } });
    expect(noCsrf.statusCode).toBe(403);

    const same = await app.inject({ method: "PATCH", url, headers, payload: { performancePatterns: true, creativeAssets: true } });
    expect(same.json().permissionVersion).toBe(1);

    const changed = await app.inject({ method: "PATCH", url, headers, payload: { performancePatterns: true, creativeAssets: false } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().sharing).toEqual({ performancePatterns: true, creativeAssets: false });
    expect(changed.json().permissionVersion).toBe(2);

    const bad = await app.inject({ method: "PATCH", url, headers, payload: { performancePatterns: "yes" } });
    expect(bad.statusCode).toBe(400);
  });

  it("cannot change another visitor's client", async () => {
    const a = await newWorld();
    const b = await newWorld();
    const res = await app.inject({
      method: "PATCH", url: `/v1/clients/${b.client["velvet-static"]}/sharing`,
      headers: { ...secret, cookie: a.cookie, "x-csrf-token": a.csrf },
      payload: { performancePatterns: true, creativeAssets: true },
    });
    expect(res.statusCode).toBe(404);
    const still = await db.query("select share_performance from clients where id = $1", [b.client["velvet-static"]]);
    expect(still.rows[0].share_performance).toBe(false);
  });
});
