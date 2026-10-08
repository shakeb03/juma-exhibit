"use client";

import { SearchCheck } from "lucide-react";
import { useOpenEvidence } from "@/components/workspace/context";
import { cn } from "@/lib/cn";
import { segmentText } from "@/lib/format";
import type { Metric } from "@/lib/types";

/** A number the user can inspect: quiet dotted underline plus a small evidence icon. Unavailable is never shown as zero. */
export function EvidenceNumber({ metric }: { metric: Metric }) {
  const open = useOpenEvidence();
  const unavailable = metric.value === null;
  return (
    <button
      type="button"
      onClick={(event) => open(metric, event.currentTarget)}
      title="Show me the numbers"
      aria-label={`${metric.label}: ${metric.display}. Show me the numbers.`}
      className={cn(
        "tabular inline-flex items-baseline gap-0.5 rounded-sm font-medium underline decoration-dotted decoration-1 underline-offset-[3px] hover:bg-amber-light",
        unavailable ? "italic text-text-muted" : "text-text",
      )}
    >
      {metric.display}
      <SearchCheck size={11} className="translate-y-px text-teal/70" aria-hidden />
    </button>
  );
}

/** Text with {{metric-id}} placeholders turned into inspectable numbers, using the supplied metric records. */
export function RichText({ text, metrics }: { text: string; metrics: Record<string, Metric> }) {
  return (
    <>
      {segmentText(text).map((part, index) => {
        if (part.type === "text") return <span key={index}>{part.value}</span>;
        const metric = metrics[part.id];
        return metric ? <EvidenceNumber key={index} metric={metric} /> : <span key={index} className="italic text-text-muted">unavailable</span>;
      })}
    </>
  );
}
