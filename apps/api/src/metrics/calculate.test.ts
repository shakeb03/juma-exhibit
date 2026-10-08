import { describe, expect, it } from "vitest";
import type { CampaignRow } from "@exhibit/contracts";
import { calculateMetrics, compareValues } from "./calculate.js";

function row(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    campaignId: "X-1",
    campaignName: "Test",
    channel: "Pinterest",
    period: "2026-09",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    currency: "USD",
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    conversions: 10,
    revenue: 500,
    attributionWindow: "7d_click",
    creativeRefId: null,
    ...overrides,
  };
}

describe("calculateMetrics", () => {
  it("computes single-row ratios", () => {
    const { metrics } = calculateMetrics("c", [row()]);
    expect(metrics.ctr.value).toBeCloseTo(0.02);
    expect(metrics.conversionRate.value).toBeCloseTo(0.05);
    expect(metrics.cpc.value).toBeCloseTo(0.5);
    expect(metrics.costPerConversion.value).toBeCloseTo(10);
    expect(metrics.roas.value).toBeCloseTo(5);
    expect(metrics.cpm.value).toBeCloseTo(10);
    expect(metrics.clicksPer1kImpressions.value).toBeCloseTo(20);
  });

  it("weights aggregate ratios by totals instead of averaging campaign ratios", () => {
    const small = row({ campaignId: "A", impressions: 1_000, clicks: 100 }); // ctr 10%
    const large = row({ campaignId: "B", impressions: 99_000, clicks: 990 }); // ctr 1%
    const { metrics } = calculateMetrics("c", [small, large]);
    // Weighted: 1090 / 100000 = 1.09%. A naive average of 10% and 1% would give 5.5%.
    expect(metrics.ctr.value).toBeCloseTo(0.0109);
    expect(metrics.ctr.inputs).toEqual({ clicks: 1090, impressions: 100_000 });
    expect(metrics.ctr.rowIds).toEqual(["A", "B"]);
  });

  it("treats a zero denominator as unavailable, not zero performance", () => {
    const { metrics } = calculateMetrics("c", [row({ impressions: 0, clicks: 0, conversions: 0, revenue: 0 })]);
    expect(metrics.ctr.value).toBeNull();
    expect(metrics.ctr.unavailableReason).toMatch(/impressions is zero/);
    expect(metrics.conversionRate.value).toBeNull();
    expect(metrics.spend.value).toBe(100);
  });

  it("marks metrics unavailable when an input is missing and names the row", () => {
    const { metrics } = calculateMetrics("c", [row({ campaignId: "A" }), row({ campaignId: "B", conversions: null, revenue: null })]);
    expect(metrics.conversions.value).toBeNull();
    expect(metrics.conversions.unavailableReason).toContain("B");
    expect(metrics.conversionRate.value).toBeNull();
    expect(metrics.roas.value).toBeNull();
    // Unaffected metrics still compute.
    expect(metrics.ctr.value).toBeCloseTo(0.02);
  });

  it("does not blend currencies", () => {
    const set = calculateMetrics("c", [row({ campaignId: "A" }), row({ campaignId: "B", currency: "EUR" })]);
    expect(set.warnings.join(" ")).toMatch(/currencies/);
    expect(set.metrics.spend.value).toBeNull();
    expect(set.metrics.roas.value).toBeNull();
    expect(set.metrics.costPerConversion.value).toBeNull();
    // Non-monetary metrics are still valid.
    expect(set.metrics.ctr.value).toBeCloseTo(0.02);
  });

  it("warns about mismatched attribution windows without hiding values", () => {
    const set = calculateMetrics("c", [row({ campaignId: "A" }), row({ campaignId: "B", attributionWindow: "30d_click" })]);
    expect(set.warnings.join(" ")).toMatch(/attribution/);
    expect(set.metrics.ctr.value).not.toBeNull();
  });

  it("returns unavailable metrics for an empty set", () => {
    const { metrics } = calculateMetrics("c", []);
    expect(metrics.ctr.value).toBeNull();
    expect(metrics.spend.unavailableReason).toBe("No campaign rows.");
  });

  it("records the formula and a stable metric ID for evidence links", () => {
    const { metrics } = calculateMetrics("RL-PIN-0901", [row()]);
    expect(metrics.ctr.id).toBe("metric:RL-PIN-0901:ctr");
    expect(metrics.ctr.formula).toBe("clicks / impressions");
  });
});

describe("compareValues", () => {
  it("computes absolute and relative change", () => {
    expect(compareValues(0.02, 0.03)).toEqual({ absolute: expect.closeTo(0.01), relative: expect.closeTo(0.5) });
  });
  it("is null when either side is unavailable or the base is zero", () => {
    expect(compareValues(null, 1)).toEqual({ absolute: null, relative: null });
    expect(compareValues(0, 1)).toEqual({ absolute: 1, relative: null });
  });
});
