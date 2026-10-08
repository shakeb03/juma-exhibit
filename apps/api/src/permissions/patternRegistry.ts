import type { MetricName } from "@exhibit/contracts";
import { METRIC_LABELS, MetricRegistry, UNIT_BY_METRIC, formatMetric, type RegistryMetric } from "../agent/registry.js";
import { SHARED_METRICS, type ClientContext, type IntelligenceContext, type NormalizedMetrics } from "./types.js";

const FORMULA: Record<(typeof SHARED_METRICS)[number], string> = {
  ctr: "clicks / impressions",
  conversionRate: "conversions / clicks",
  clicksPer1kImpressions: "clicks / impressions * 1000",
  conversionsPer1kImpressions: "conversions / impressions * 1000",
  cpm: "spend / impressions * 1000",
  roas: "revenue / spend",
};

const WITHHELD = "Only this normalized rate is shared; the raw totals behind it are withheld under performance-pattern approval.";

function register(
  registry: MetricRegistry,
  scopeId: string,
  label: string,
  metrics: NormalizedMetrics,
  refs: string[],
  currency: string | null,
) {
  const records: RegistryMetric[] = SHARED_METRICS.map((name: MetricName & (typeof SHARED_METRICS)[number]) => ({
    id: `metric:${scopeId}:${name}`,
    label: METRIC_LABELS[name],
    unit: UNIT_BY_METRIC[name],
    change: "none",
    value: metrics.values[name],
    unavailableReason: metrics.unavailable[name] ?? null,
    formula: `${FORMULA[name]} (${WITHHELD})`,
    inputs: {},
    rowIds: refs,
    currency: ["cpm"].includes(name) ? currency : null,
  }));
  registry.registerExternal({ scopeId, label, campaignIds: refs, warnings: [] }, records);
}

/**
 * Turn the approved, normalized context into metrics a model can cite by ID. Everything here already passed the
 * permission filter, so these values (and nothing else) are what cross-client answers may quote. The same
 * placeholder, table, and evidence-drawer machinery used for single-client work then applies unchanged.
 */
export function buildPatternRegistry(context: IntelligenceContext): MetricRegistry {
  const registry = new MetricRegistry();
  for (const client of context.clients) {
    for (const campaign of client.campaigns) {
      register(registry, `${client.slug}:${campaign.campaignId}`, `${client.name}, ${campaign.channel} ${campaign.period}`, campaign.metrics, [campaign.ref], campaign.currency);
    }
    for (const [dimension, groups] of Object.entries(client.patterns) as [string, ClientContext["patterns"]["visualStyle"]][]) {
      for (const group of groups) {
        const currency = client.campaigns[0]?.currency ?? null;
        register(registry, `${client.slug}:${dimension}:${group.value}`, `${client.name}, ${group.value} (all channels)`, group.overall, group.refs, currency);
        for (const channel of group.byChannel) {
          register(registry, `${client.slug}:${dimension}:${group.value}:${channel.channel}`, `${client.name}, ${group.value} on ${channel.channel}`, channel.metrics, group.refs, currency);
        }
      }
    }
  }
  return registry;
}

/** A compact listing for the prompt: every citable scope with its values, so the model never has to guess an ID. */
export function describePatternRegistry(registry: MetricRegistry): string {
  return registry
    .allScopes()
    .map((scope) => {
      const cells = SHARED_METRICS.map((name) => {
        const metric = registry.get(`metric:${scope.scopeId}:${name}`)!;
        return `${name}=${formatMetric(metric)}`;
      });
      return `- scope "${scope.scopeId}" = ${scope.label}: ${cells.join(", ")}`;
    })
    .join("\n");
}
