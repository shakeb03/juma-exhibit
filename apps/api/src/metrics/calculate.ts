import type { CampaignRow, Metric, MetricName, MetricSet } from "@exhibit/contracts";

type Totals = "spend" | "impressions" | "clicks" | "conversions" | "revenue";
const TOTALS: Totals[] = ["spend", "impressions", "clicks", "conversions", "revenue"];
const MONEY: ReadonlySet<MetricName> = new Set(["spend", "revenue", "cpc", "costPerConversion", "cpm"]);
const MONEY_TOTALS: ReadonlySet<Totals> = new Set(["spend", "revenue"]);

interface RatioSpec {
  name: MetricName;
  formula: string;
  numerator: Totals;
  denominator: Totals;
  scale: number;
}

/** Ratios are always computed from totals, never by averaging campaign-level ratios. */
const RATIOS: RatioSpec[] = [
  { name: "ctr", formula: "clicks / impressions", numerator: "clicks", denominator: "impressions", scale: 1 },
  { name: "conversionRate", formula: "conversions / clicks", numerator: "conversions", denominator: "clicks", scale: 1 },
  { name: "cpc", formula: "spend / clicks", numerator: "spend", denominator: "clicks", scale: 1 },
  { name: "costPerConversion", formula: "spend / conversions", numerator: "spend", denominator: "conversions", scale: 1 },
  { name: "roas", formula: "revenue / spend", numerator: "revenue", denominator: "spend", scale: 1 },
  { name: "cpm", formula: "spend / impressions * 1000", numerator: "spend", denominator: "impressions", scale: 1000 },
  { name: "clicksPer1kImpressions", formula: "clicks / impressions * 1000", numerator: "clicks", denominator: "impressions", scale: 1000 },
  { name: "conversionsPer1kImpressions", formula: "conversions / impressions * 1000", numerator: "conversions", denominator: "impressions", scale: 1000 },
];

function metricId(scope: string, name: MetricName): string {
  return `metric:${scope}:${name}`;
}

/**
 * Sum one total across rows. If any row lacks the value, the total is unavailable:
 * a partial sum would silently understate the campaign group.
 */
function sumTotal(rows: CampaignRow[], key: Totals): { value: number | null; missing: string[] } {
  const missing = rows.filter((row) => row[key] === null).map((row) => row.campaignId);
  if (missing.length > 0 || rows.length === 0) return { value: null, missing };
  const value = rows.reduce((total, row) => total + (row[key] as number), 0);
  return { value: Math.round(value * 100) / 100, missing };
}

/**
 * Calculate every metric for a group of campaign rows.
 *
 * - Zero denominators are unavailable, not zero performance.
 * - Missing inputs make dependent metrics unavailable and say which rows are missing.
 * - Rows with different currencies are not blended: money metrics become unavailable.
 * - Rows with different attribution windows are flagged as a warning.
 */
export function calculateMetrics(scope: string, rows: CampaignRow[]): MetricSet {
  const rowIds = rows.map((row) => row.campaignId);
  const warnings: string[] = [];

  const currencies = [...new Set(rows.map((row) => row.currency))];
  const mixedCurrency = currencies.length > 1;
  if (mixedCurrency) {
    warnings.push(`Rows use different currencies (${currencies.join(", ")}); monetary metrics are not calculated.`);
  }
  const attributions = [...new Set(rows.map((row) => row.attributionWindow))];
  if (attributions.length > 1) {
    warnings.push(`Rows use different attribution windows (${attributions.join(", ")}); results are not directly comparable.`);
  }
  const currency = mixedCurrency || rows.length === 0 ? null : (currencies[0] ?? null);

  const totals = {} as Record<Totals, { value: number | null; missing: string[] }>;
  for (const key of TOTALS) totals[key] = sumTotal(rows, key);

  const metrics = {} as Record<MetricName, Metric>;

  for (const key of TOTALS) {
    const total = totals[key];
    let reason: string | null = null;
    if (rows.length === 0) reason = "No campaign rows.";
    else if (total.missing.length > 0) reason = `Missing ${key} for ${total.missing.join(", ")}.`;
    else if (mixedCurrency && MONEY.has(key)) reason = "Mixed currencies are not blended.";
    metrics[key] = {
      id: metricId(scope, key),
      name: key,
      value: reason ? null : total.value,
      unavailableReason: reason,
      formula: `sum(${key})`,
      inputs: {},
      rowIds,
      currency: MONEY.has(key) ? currency : null,
    };
  }

  for (const spec of RATIOS) {
    const numerator = totals[spec.numerator].value;
    const denominator = totals[spec.denominator].value;
    let reason: string | null = null;
    let value: number | null = null;

    if (rows.length === 0) reason = "No campaign rows.";
    // Any ratio built from spend or revenue (including unitless ROAS) needs a single currency.
    else if (mixedCurrency && (MONEY_TOTALS.has(spec.numerator) || MONEY_TOTALS.has(spec.denominator))) {
      reason = "Mixed currencies are not blended.";
    } else if (numerator === null) reason = metrics[spec.numerator].unavailableReason;
    else if (denominator === null) reason = metrics[spec.denominator].unavailableReason;
    else if (denominator === 0) reason = `${spec.denominator} is zero, so ${spec.name} is undefined.`;
    else value = (numerator / denominator) * spec.scale;

    metrics[spec.name] = {
      id: metricId(scope, spec.name),
      name: spec.name,
      value,
      unavailableReason: reason,
      formula: spec.formula,
      inputs: { [spec.numerator]: numerator, [spec.denominator]: denominator },
      rowIds,
      currency: MONEY.has(spec.name) ? currency : null,
    };
  }

  return { scope, rowIds, metrics, warnings };
}

/** Group rows by a key and calculate each group, preserving first-seen order. */
export function calculateGroups(
  scopePrefix: string,
  rows: CampaignRow[],
  groupKey: (row: CampaignRow) => string,
): MetricSet[] {
  const groups = new Map<string, CampaignRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, group]) => calculateMetrics(`${scopePrefix}:${key}`, group));
}

/** Percentage-point and relative change between two values; null if either is unavailable. */
export function compareValues(before: number | null, after: number | null) {
  if (before === null || after === null) return { absolute: null, relative: null };
  return { absolute: after - before, relative: before === 0 ? null : (after - before) / before };
}
