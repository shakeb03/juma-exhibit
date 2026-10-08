"use client";

import type { Block, Metric } from "@/lib/types";
import { RichText, EvidenceNumber } from "./rich-text";
import { Statement } from "./statement";

const METRIC_ORDER = ["spend", "revenue", "roas", "conversions", "costPerConversion", "conversionRate", "impressions", "clicks", "ctr", "cpc", "cpm", "clicksPer1kImpressions", "conversionsPer1kImpressions"];

/** One layout per block type. Text carries {{metric-id}} placeholders that become inspectable numbers. */
export function BlockView({ block, metrics }: { block: Block; metrics: Record<string, Metric> }) {
  const rich = (text: string) => <RichText text={text} metrics={metrics} />;

  switch (block.type) {
    case "heading": {
      const className = block.level === 1 ? "text-[22px] font-medium tracking-tight" : block.level === 2 ? "mt-2 text-[17px] font-medium" : "text-[15px] font-medium";
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return <Tag className={className}>{rich(block.text)}</Tag>;
    }
    case "paragraph":
      return <p className="text-[15px] leading-relaxed">{rich(block.text)}</p>;
    case "metric_table": {
      const names = [...block.metrics].sort((a, b) => METRIC_ORDER.indexOf(a) - METRIC_ORDER.indexOf(b));
      return (
        <figure>
          <div className="scroll-quiet overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="tabular w-full min-w-[420px] text-left text-sm">
              <caption className="border-b border-border bg-surface-muted px-3 py-2 text-left text-xs font-medium text-text-muted">{block.caption}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 font-medium text-text-muted"><span className="sr-only">Metric</span></th>
                  {block.scopes.map((scope) => <th key={scope.scopeId} scope="col" className="px-3 py-2 text-right font-medium">{scope.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {names.map((name) => (
                  <tr key={name} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2 font-normal text-text-muted">{metrics[`metric:${block.scopes[0]!.scopeId}:${name}`]?.label ?? name}</th>
                    {block.scopes.map((scope) => {
                      const metric = metrics[`metric:${scope.scopeId}:${name}`];
                      return <td key={scope.scopeId} className="px-3 py-2 text-right">{metric ? <EvidenceNumber metric={metric} /> : <span className="italic text-text-muted">unavailable</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      );
    }
    case "observation":
      return <Statement kind="observation">{rich(block.text)}</Statement>;
    case "hypothesis":
      return <Statement kind="hypothesis">{rich(block.text)}</Statement>;
    case "recommendation":
      return (
        <Statement
          kind="recommendation"
          details={[
            { label: "Why", content: rich(block.reasoning) },
            { label: "Measure", content: rich(block.measurement) },
            { label: "Limit", content: rich(block.limitation) },
          ]}
        >
          {rich(block.text)}
        </Statement>
      );
    case "experiment":
      return (
        <Statement
          kind="recommendation"
          details={[
            { label: "Hypothesis", content: rich(block.hypothesis) },
            { label: "Design", content: rich(block.design) },
            { label: "Measure", content: rich(block.measurement) },
            { label: "Limit", content: rich(block.limitation) },
          ]}
        >
          <strong className="font-medium">{rich(block.title)}</strong>
        </Statement>
      );
    case "limitation":
      return <Statement kind="limitation">{rich(block.text)}</Statement>;
  }
}
