import { describe, expect, it } from "vitest";
import type { CampaignRow } from "@exhibit/contracts";
import { MetricRegistry, extractPlaceholders, formatMetric, renderText } from "./registry.js";

const row = (id: string, o: Partial<CampaignRow> = {}): CampaignRow => ({
  campaignId: id, campaignName: id, channel: "Pinterest", period: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30",
  currency: "USD", spend: 1000, impressions: 100_000, clicks: 2000, conversions: 40, revenue: 4000,
  attributionWindow: "7d_click", creativeRefId: null, ...o,
});

describe("MetricRegistry", () => {
  it("registers a campaign scope with stable metric IDs", () => {
    const registry = new MetricRegistry();
    const { scope } = registry.addScope("Summit", [row("RL-1")]);
    expect(scope.scopeId).toBe("RL-1");
    expect(registry.get("metric:RL-1:ctr")?.value).toBeCloseTo(0.02);
  });

  it("returns the existing scope when the same campaigns are requested again", () => {
    const registry = new MetricRegistry();
    const a = registry.addScope("First name", [row("A"), row("B")]);
    const b = registry.addScope("Another name", [row("B"), row("A")]);
    expect(b.scope.scopeId).toBe(a.scope.scopeId);
    expect(registry.allScopes()).toHaveLength(1);
  });

  it("gives different groups different scope IDs even with the same label", () => {
    const registry = new MetricRegistry();
    const a = registry.addScope("Pinterest", [row("A"), row("B")]);
    const b = registry.addScope("Pinterest", [row("C"), row("D")]);
    expect(a.scope.scopeId).not.toBe(b.scope.scopeId);
  });

  it("computes changes between scopes in code", () => {
    const registry = new MetricRegistry();
    registry.addScope("before", [row("A", { clicks: 1000 })]); // ctr 1%
    registry.addScope("after", [row("B", { clicks: 2000 })]); // ctr 2%
    const [abs, rel] = registry.compare("A", "B", ["ctr"]);
    expect(abs!.value).toBeCloseTo(0.01);
    expect(rel!.value).toBeCloseTo(1);
    expect(formatMetric(abs!)).toBe("+1.00 pp");
    expect(formatMetric(rel!)).toBe("+100.0%");
    expect(abs!.id).toBe("cmp:A->B:ctr:abs");
  });

  it("marks a relative change unavailable when the base is zero or a value is missing", () => {
    const registry = new MetricRegistry();
    registry.addScope("a", [row("A", { conversions: 0 })]);
    registry.addScope("b", [row("B", { conversions: 10 })]);
    const [abs, rel] = registry.compare("A", "B", ["conversions"]);
    expect(abs!.value).toBe(10);
    expect(rel!.value).toBeNull();
    expect(rel!.unavailableReason).toMatch(/zero/);

    registry.addScope("c", [row("C", { conversions: null })]);
    const [absMissing] = registry.compare("A", "C", ["conversions"]);
    expect(absMissing!.value).toBeNull();
  });

  it("restores saved metrics for revisions", () => {
    const first = new MetricRegistry();
    first.addScope("x", [row("A")]);
    const second = new MetricRegistry();
    second.preload(first.allMetrics(), first.allScopes());
    expect(second.get("metric:A:roas")?.value).toBeCloseTo(4);
    expect(second.scope("A")).toBeDefined();
  });
});

describe("formatting", () => {
  const base = { change: "none" as const, currency: "USD" };
  it("formats each unit", () => {
    expect(formatMetric({ ...base, value: 0.02346, unit: "percent" })).toBe("2.35%");
    expect(formatMetric({ ...base, value: 12600, unit: "currency" })).toBe("$12,600");
    expect(formatMetric({ ...base, value: 0.5, unit: "currency" })).toBe("$0.50");
    expect(formatMetric({ ...base, value: 4.7234, unit: "multiple" })).toBe("4.72x");
    expect(formatMetric({ ...base, value: 18.444, unit: "per1k" })).toBe("18.44");
    expect(formatMetric({ ...base, value: 33800, unit: "count" })).toBe("33,800");
    expect(formatMetric({ ...base, currency: "EUR", value: 15200, unit: "currency" })).toBe("€15,200");
  });
  it("never shows unavailable values as zero", () => {
    expect(formatMetric({ ...base, value: null, unit: "percent" })).toBe("unavailable");
  });
});

describe("placeholders", () => {
  it("extracts and renders IDs, leaving unknown ones as unavailable", () => {
    const registry = new MetricRegistry();
    registry.addScope("x", [row("A")]);
    const text = "CTR was {{metric:A:ctr}} and ROAS {{ metric:A:roas }}; also {{nope}}.";
    expect(extractPlaceholders(text)).toEqual(["metric:A:ctr", "metric:A:roas", "nope"]);
    expect(renderText(text, (id) => registry.get(id))).toBe("CTR was 2.00% and ROAS 4.00x; also unavailable.");
  });
});
