"use client";

import { useState } from "react";
import type { Block, Metric, ProducedBy } from "@/lib/types";
import { MetricChart } from "./metric-chart";
import { RichText, EvidenceNumber } from "./rich-text";
import { Statement } from "./statement";
import { BlockXray } from "./xray";

const METRIC_ORDER = ["spend", "revenue", "roas", "conversions", "costPerConversion", "conversionRate", "impressions", "clicks", "ctr", "cpc", "cpm", "clicksPer1kImpressions", "conversionsPer1kImpressions"];

type Table = Extract<Block, { type: "metric_table" }>;

/** A comparison as a chart or a table. The table is always available as the text alternative. */
function MetricTable({ block, metrics, accent }: { block: Table; metrics: Record<string, Metric>; accent: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const names = [...block.metrics].sort((a, b) => METRIC_ORDER.indexOf(a) - METRIC_ORDER.indexOf(b));
  return (
    <figure>
      <div className="mb-2 flex items-center justify-between gap-3">
        <figcaption className="text-xs font-medium text-text-muted">{block.caption}</figcaption>
        <div role="group" aria-label="View" className="flex shrink-0 rounded-full bg-surface-muted p-0.5 text-xs">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-7 rounded-full px-3 font-medium ${view === v ? "bg-surface shadow-sm" : "text-text-muted"}`}>
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {view === "chart" ? (
        <MetricChart block={block} metrics={metrics} accent={accent} />
      ) : (
        <div className="scroll-quiet overflow-x-auto rounded-[var(--radius-control)] border border-border">
          <table className="tabular w-full min-w-[420px] text-left text-sm">
            <caption className="sr-only">{block.caption}</caption>
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
      )}
    </figure>
  );
}

/** One layout per block type. Text carries {{metric-id}} placeholders that become inspectable numbers. */
export function BlockView({
  block, metrics, accent, produced, observationOrder,
}: { block: Block; metrics: Record<string, Metric>; accent: string; produced?: ProducedBy; observationOrder: string[] }) {
  return (
    <div>
      <BlockBody block={block} metrics={metrics} accent={accent} />
      <BlockXray block={block} metrics={metrics} produced={produced} observationOrder={observationOrder} />
    </div>
  );
}

function BlockBody({ block, metrics, accent }: { block: Block; metrics: Record<string, Metric>; accent: string }) {
  const rich = (text: string) => <RichText text={text} metrics={metrics} />;

  switch (block.type) {
    case "heading": {
      const className = block.level === 1 ? "text-[22px] font-medium tracking-tight" : block.level === 2 ? "mt-2 text-[17px] font-medium" : "text-[15px] font-medium";
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return <Tag className={className}>{rich(block.text)}</Tag>;
    }
    case "paragraph":
      return <p className="text-[15px] leading-relaxed">{rich(block.text)}</p>;
    case "metric_table":
      return <MetricTable block={block} metrics={metrics} accent={accent} />;
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
