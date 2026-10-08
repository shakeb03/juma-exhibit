import type { CampaignRow, MetricName, MetricSet } from "@exhibit/contracts";
import { calculateMetrics, compareValues } from "../metrics/calculate.js";

export type Unit = "count" | "currency" | "percent" | "multiple" | "per1k";

export const UNIT_BY_METRIC: Record<MetricName, Unit> = {
  spend: "currency",
  revenue: "currency",
  cpc: "currency",
  costPerConversion: "currency",
  cpm: "currency",
  impressions: "count",
  clicks: "count",
  conversions: "count",
  ctr: "percent",
  conversionRate: "percent",
  roas: "multiple",
  clicksPer1kImpressions: "per1k",
  conversionsPer1kImpressions: "per1k",
};

/** A metric the model may cite. Derived comparisons (change between two scopes) are metrics too. */
export interface RegistryMetric {
  id: string;
  label: string;
  unit: Unit;
  change: "none" | "absolute" | "relative";
  value: number | null;
  unavailableReason: string | null;
  formula: string;
  inputs: Record<string, number | null>;
  rowIds: string[];
  currency: string | null;
}

export interface RegistryScope {
  scopeId: string;
  label: string;
  campaignIds: string[];
  warnings: string[];
}

const LABELS: Record<MetricName, string> = {
  spend: "Spend",
  revenue: "Revenue",
  cpc: "Cost per click",
  costPerConversion: "Cost per conversion",
  cpm: "CPM",
  impressions: "Impressions",
  clicks: "Clicks",
  conversions: "Conversions",
  ctr: "Click-through rate",
  conversionRate: "Conversion rate",
  roas: "ROAS",
  clicksPer1kImpressions: "Clicks per 1,000 impressions",
  conversionsPer1kImpressions: "Conversions per 1,000 impressions",
};

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
const number = (value: number, decimals: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** The one place values become display text. Models never format numbers themselves. */
export function formatMetric(metric: Pick<RegistryMetric, "value" | "unit" | "change" | "currency">): string {
  const { value, unit, change, currency } = metric;
  if (value === null) return "unavailable";
  const sign = change !== "none" ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  const abs = Math.abs(value);
  if (change === "relative") return `${sign}${number(abs * 100, 1)}%`;
  let body: string;
  switch (unit) {
    case "count":
      body = number(abs, 0);
      break;
    case "currency": {
      const symbol = currency ? (CURRENCY_SYMBOL[currency] ?? `${currency} `) : "";
      body = `${symbol}${number(abs, abs >= 1000 ? 0 : 2)}`;
      break;
    }
    case "percent":
      body = change === "absolute" ? `${number(abs * 100, 2)} pp` : `${number(abs * 100, 2)}%`;
      break;
    case "multiple":
      body = `${number(abs, 2)}x`;
      break;
    case "per1k":
      body = number(abs, 2);
      break;
  }
  return `${sign}${body}`;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/** Replace {{metric-id}} with the verified, formatted value. Unknown IDs show as unavailable, never a guess. */
export function renderText(text: string, lookup: (id: string) => RegistryMetric | undefined): string {
  return text.replace(PLACEHOLDER, (_, id: string) => {
    const metric = lookup(id);
    return metric ? formatMetric(metric) : "unavailable";
  });
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "group";

/** Holds every metric calculated during one execution. Numbers originate here, in code. */
export class MetricRegistry {
  private readonly scopes = new Map<string, RegistryScope>();
  private readonly metrics = new Map<string, RegistryMetric>();

  /** Calculate metrics for a group of campaign rows and register them. Re-asking for the same rows is a no-op. */
  addScope(label: string, rows: CampaignRow[]): { scope: RegistryScope; set: MetricSet } {
    const campaignIds = rows.map((row) => row.campaignId);
    const key = [...campaignIds].sort().join("|");
    const existing = [...this.scopes.values()].find((scope) => [...scope.campaignIds].sort().join("|") === key);
    const scopeId = existing?.scopeId ?? this.newScopeId(label, campaignIds);
    const set = calculateMetrics(scopeId, rows);
    const scope: RegistryScope = existing ?? { scopeId, label, campaignIds, warnings: set.warnings };
    this.scopes.set(scopeId, scope);
    for (const metric of Object.values(set.metrics)) {
      this.metrics.set(metric.id, {
        id: metric.id,
        label: LABELS[metric.name],
        unit: UNIT_BY_METRIC[metric.name],
        change: "none",
        value: metric.value,
        unavailableReason: metric.unavailableReason,
        formula: metric.formula,
        inputs: metric.inputs,
        rowIds: metric.rowIds,
        currency: metric.currency,
      });
    }
    return { scope, set };
  }

  private newScopeId(label: string, campaignIds: string[]): string {
    const base = campaignIds.length === 1 ? campaignIds[0]! : `group:${slug(label)}`;
    let id = base;
    for (let n = 2; this.scopes.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  scope(scopeId: string): RegistryScope | undefined {
    return this.scopes.get(scopeId);
  }

  get(id: string): RegistryMetric | undefined {
    return this.metrics.get(id);
  }

  /** Change between two registered scopes, computed in code, for each requested metric. */
  compare(fromScopeId: string, toScopeId: string, names: MetricName[]): RegistryMetric[] {
    const out: RegistryMetric[] = [];
    for (const name of names) {
      const before = this.metrics.get(`metric:${fromScopeId}:${name}`);
      const after = this.metrics.get(`metric:${toScopeId}:${name}`);
      if (!before || !after) continue;
      const change = compareValues(before.value, after.value);
      const reasonFor = (kind: "absolute" | "relative") =>
        before.value === null || after.value === null
          ? `${before.value === null ? before.unavailableReason : after.unavailableReason}`
          : kind === "relative" && change.relative === null
            ? "The earlier value is zero, so a relative change is undefined."
            : null;
      for (const kind of ["absolute", "relative"] as const) {
        const derived: RegistryMetric = {
          id: `cmp:${fromScopeId}->${toScopeId}:${name}:${kind === "absolute" ? "abs" : "rel"}`,
          label: `${before.label}, ${kind} change`,
          unit: before.unit,
          change: kind,
          value: reasonFor(kind) ? null : (kind === "absolute" ? change.absolute : change.relative),
          unavailableReason: reasonFor(kind),
          formula: kind === "absolute" ? `${name}(to) − ${name}(from)` : `(${name}(to) − ${name}(from)) / ${name}(from)`,
          inputs: { from: before.value, to: after.value },
          rowIds: [...before.rowIds, ...after.rowIds],
          currency: before.currency,
        };
        this.metrics.set(derived.id, derived);
        out.push(derived);
      }
    }
    return out;
  }

  /** Restore metrics from a saved artifact version, so a revision can keep citing them. */
  preload(metrics: Record<string, RegistryMetric>, scopes: RegistryScope[]): void {
    for (const [id, metric] of Object.entries(metrics)) this.metrics.set(id, metric);
    for (const scope of scopes) this.scopes.set(scope.scopeId, scope);
  }

  allMetrics(): Record<string, RegistryMetric> {
    return Object.fromEntries(this.metrics);
  }

  allScopes(): RegistryScope[] {
    return [...this.scopes.values()];
  }
}
