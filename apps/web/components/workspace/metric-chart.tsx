"use client";

import type { Block, Metric } from "@/lib/types";
import { EvidenceNumber } from "./rich-text";

type Table = Extract<Block, { type: "metric_table" }>;

/** The metrics that read well as comparison bars, in the order they matter. Counts and money totals scale poorly side by side. */
const CHART_ORDER = ["roas", "ctr", "conversionRate", "costPerConversion", "cpc", "conversionsPer1kImpressions", "clicksPer1kImpressions", "cpm", "conversions", "revenue", "spend"];

/**
 * Grouped horizontal bars for a metric table. Each bar is scaled within its own metric, so a rate and a
 * cost never share an axis. Values are the same inspectable numbers as the table, and the table stays one click away.
 */
export function MetricChart({ block, metrics, accent }: { block: Table; metrics: Record<string, Metric>; accent: string }) {
  const names = CHART_ORDER.filter((name) => block.metrics.includes(name as Table["metrics"][number])).slice(0, 4);
  if (names.length === 0) return <p className="text-sm text-text-muted">These metrics are easier to read in the table.</p>;

  return (
    <div className="space-y-4" role="group" aria-label={block.caption || "Comparison chart"}>
      {names.map((name) => {
        const cells = block.scopes.map((scope) => ({ scope, metric: metrics[`metric:${scope.scopeId}:${name}`] }));
        const label = cells.find((c) => c.metric)?.metric?.label ?? name;
        const max = Math.max(0, ...cells.map((c) => c.metric?.value ?? 0));
        return (
          <div key={name}>
            <p className="mb-1.5 text-xs font-medium text-text-muted">{label}</p>
            <ul className="space-y-1.5">
              {cells.map(({ scope, metric }, index) => {
                const width = metric && metric.value !== null && max > 0 ? Math.max(2, (metric.value / max) * 100) : 0;
                return (
                  <li key={scope.scopeId} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate" title={scope.label}>{scope.label}</span>
                    <span className="h-3 rounded-full bg-surface-muted" aria-hidden>
                      {width > 0 && (
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${width}%`,
                            // The first group is solid, later groups are hatched, so they differ without colour alone.
                            background: index === 0 ? accent : `repeating-linear-gradient(135deg, ${accent}, ${accent} 3px, color-mix(in srgb, ${accent} 35%, white) 3px, color-mix(in srgb, ${accent} 35%, white) 6px)`,
                          }}
                        />
                      )}
                    </span>
                    <span className="tabular min-w-[4.5rem] text-right">
                      {metric ? <EvidenceNumber metric={metric} tag={false} /> : <span className="italic text-text-muted">unavailable</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
