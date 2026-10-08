import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import type { CampaignRow } from "@exhibit/contracts";
import { calculateMetrics } from "./calculate.js";
import { parseCampaignCsv } from "./csv.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");
const read = (path: string) => readFileSync(join(fixtures, path), "utf8");
const key = JSON.parse(read("evaluations/answer-key.json")) as {
  clients: Record<string, Record<string, Record<string, Record<string, number | null>>> & { latestTwoPinterest: { campaignIds: string[] } | null }>;
};

/** Answer-key field -> application metric name. */
const FIELDS: Record<string, string> = {
  spend: "spend",
  impressions: "impressions",
  clicks: "clicks",
  conversions: "conversions",
  revenue: "revenue",
  ctr: "ctr",
  conversionRate: "conversionRate",
  cpc: "cpc",
  costPerConversion: "costPerConversion",
  roas: "roas",
  cpm: "cpm",
  clicksPer1kImpressions: "clicksPer1kImpressions",
  conversionsPer1kImpressions: "conversionsPer1kImpressions",
};

function expectMatches(actual: ReturnType<typeof calculateMetrics>, expected: Record<string, unknown>, label: string) {
  for (const [field, name] of Object.entries(FIELDS)) {
    const want = expected[field] as number | null;
    const got = actual.metrics[name as keyof typeof actual.metrics].value;
    if (want === null) expect(got, `${label} ${field}`).toBeNull();
    else expect(got, `${label} ${field}`).toBeCloseTo(want, 5);
  }
}

describe.each(Object.keys(key.clients))("answer key: %s", (slug) => {
  const parsed = parseCampaignCsv(read(`clients/${slug}/campaigns.csv`));
  const expected = key.clients[slug]!;

  it("parses every campaign row without issues", () => {
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  it("matches per-campaign metrics", () => {
    for (const [id, want] of Object.entries(expected.byCampaign as Record<string, Record<string, unknown>>)) {
      const rows = parsed.rows.filter((r) => r.campaignId === id);
      expectMatches(calculateMetrics(id, rows), want, id);
    }
  });

  it("matches channel and period aggregates", () => {
    for (const [group, want] of Object.entries(expected.byChannelPeriod as Record<string, Record<string, unknown>>)) {
      const [channel, period] = group.split("|");
      const rows = parsed.rows.filter((r) => r.channel === channel && r.period === period);
      expectMatches(calculateMetrics(group, rows), want, group);
    }
  });

  it("matches groupings by visual style and storytelling approach", () => {
    const refs: Record<string, string>[] = parse(read(`clients/${slug}/creative_references.csv`), { columns: true, skip_empty_lines: true });
    const byCampaign = new Map(refs.map((ref) => [ref.campaign_id, ref]));
    const check = (field: "visual_style" | "storytelling_approach", section: string) => {
      for (const [value, want] of Object.entries(expected[section] as Record<string, Record<string, unknown>>)) {
        const rows: CampaignRow[] = parsed.rows.filter((r) => byCampaign.get(r.campaignId)?.[field] === value);
        expect(rows.map((r) => r.campaignId).sort()).toEqual((want.campaignIds as string[]).slice().sort());
        expectMatches(calculateMetrics(`${section}:${value}`, rows), want, `${section}:${value}`);
      }
    };
    check("visual_style", "byVisualStyle");
    check("storytelling_approach", "byStorytelling");
  });

  it("identifies the latest two Pinterest campaigns by end date", () => {
    const ids = parsed.rows
      .filter((r) => r.channel === "Pinterest")
      .sort((a, b) => b.endDate.localeCompare(a.endDate))
      .slice(0, 2)
      .map((r) => r.campaignId);
    if (expected.latestTwoPinterest) expect(ids).toEqual(expected.latestTwoPinterest.campaignIds);
    else expect(ids.length).toBeLessThan(2);
  });
});

describe("challenge files", () => {
  it("reports missing values and zero denominators as unavailable", () => {
    const { rows, issues } = parseCampaignCsv(read("challenges/ridgeline-pinterest-partial-export.csv"));
    expect(issues).toEqual([]);
    const missing = calculateMetrics("RL-PIN-1001", rows.filter((r) => r.campaignId === "RL-PIN-1001"));
    expect(missing.metrics.conversions.value).toBeNull();
    expect(missing.metrics.conversions.unavailableReason).toContain("RL-PIN-1001");
    expect(missing.metrics.roas.value).toBeNull();
    expect(missing.metrics.ctr.value).toBeCloseTo(3380 / 260000);

    const zero = calculateMetrics("RL-PIN-1002", rows.filter((r) => r.campaignId === "RL-PIN-1002"));
    expect(zero.metrics.ctr.value).toBeNull();
    expect(zero.metrics.ctr.unavailableReason).toMatch(/zero/);
    expect(zero.metrics.spend.value).toBe(300);
  });

  it("does not blend EUR rows with USD rows and flags the attribution mismatch", () => {
    const usd = parseCampaignCsv(read("clients/marlowe-finch/campaigns.csv")).rows.filter((r) => r.channel === "Meta" && r.period === "2026-09");
    const eur = parseCampaignCsv(read("challenges/marlowe-finch-eu-campaigns.csv")).rows.filter((r) => r.channel === "Meta");
    const mixed = calculateMetrics("mixed", [...usd, ...eur]);
    expect(mixed.metrics.spend.value).toBeNull();
    expect(mixed.metrics.roas.value).toBeNull();
    expect(mixed.warnings.join(" ")).toMatch(/currencies/);
    expect(mixed.warnings.join(" ")).toMatch(/attribution/);
  });
});

describe("parseCampaignCsv", () => {
  it("rejects files with missing required columns", () => {
    const result = parseCampaignCsv("campaign_id,spend\nA,1\n");
    expect(result.rows).toEqual([]);
    expect(result.issues[0]?.message).toMatch(/Missing columns/);
  });

  it("reports malformed rows by line and keeps valid ones", () => {
    const header = "campaign_id,campaign_name,channel,period,start_date,end_date,currency,spend,impressions,clicks,conversions,revenue,attribution_window,creative_ref_id\n";
    const good = "A,Good,Pinterest,2026-09,2026-09-01,2026-09-02,USD,10,1000,10,1,20,7d_click,\n";
    const bad = "B,Bad,Pinterest,2026-09,2026-09-01,2026-09-02,USD,abc,1000,10,1,20,7d_click,\n";
    const result = parseCampaignCsv(header + good + bad);
    expect(result.rows.map((r) => r.campaignId)).toEqual(["A"]);
    expect(result.issues).toEqual([{ line: 3, message: expect.stringContaining("spend") }]);
  });
});
