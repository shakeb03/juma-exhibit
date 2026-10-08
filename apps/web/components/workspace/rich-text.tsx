"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useOpenEvidence, useWorkspace } from "@/components/workspace/context";
import { cn } from "@/lib/cn";
import { formatInput, segmentText } from "@/lib/format";
import type { Metric } from "@/lib/types";

const shortId = (id: string) => id.replace(/^metric:/, "");

/** A small card that peeks at the calculation without opening the drawer. Positioned from the number's rectangle. */
function Peek({ metric, rect, id }: { metric: Metric; rect: DOMRect; id: string }) {
  const above = rect.top > 190;
  const left = Math.min(Math.max(8, rect.left - 8), window.innerWidth - 296);
  const inputs = Object.entries(metric.inputs).slice(0, 3);
  return createPortal(
    <div
      id={id}
      role="tooltip"
      style={{ left, ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) }}
      className="fade-in pointer-events-none fixed z-50 w-72 rounded-[var(--radius-control)] border border-border-strong bg-surface p-3 text-left shadow-float"
    >
      <p className="text-xs font-medium text-text-muted">{metric.label}</p>
      <p className="tabular text-lg font-medium leading-tight">{metric.display}</p>
      <p className="mt-1.5 rounded bg-surface-muted px-2 py-1 font-mono text-[11px] leading-snug">{metric.formula}</p>
      {inputs.length > 0 && (
        <p className="tabular mt-1.5 text-xs text-text-muted">
          {inputs.map(([name, value]) => `${name}: ${formatInput(name, value, metric)}`).join(" · ")}
        </p>
      )}
      <p className="mt-2 text-xs text-teal">Click to show the numbers</p>
    </div>,
    document.body,
  );
}

/**
 * A number the user can inspect. Quiet by default: a dotted underline. Hovering or focusing peeks at the
 * formula; clicking opens the full evidence. X-ray mode also prints the metric ID next to it.
 */
export function EvidenceNumber({ metric, tag = true }: { metric: Metric; tag?: boolean }) {
  const open = useOpenEvidence();
  const { xray } = useWorkspace();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const peekId = useId();
  const unavailable = metric.value === null;
  const show = (el: HTMLElement) => setRect(el.getBoundingClientRect());

  return (
    <>
      <button
        type="button"
        onClick={(event) => { setRect(null); open(metric, event.currentTarget); }}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setRect(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setRect(null)}
        aria-describedby={rect ? peekId : undefined}
        aria-label={`${metric.label}: ${metric.display}. Show me the numbers.`}
        className={cn(
          "tabular rounded-sm font-medium underline decoration-dotted decoration-1 underline-offset-[3px] hover:bg-amber-light",
          unavailable ? "italic text-text-muted" : "text-text",
        )}
      >
        {metric.display}
      </button>
      {xray && tag && (
        <span className="ml-0.5 align-super font-mono text-[9px] leading-none text-amber-dark" title={metric.id}>
          ✓ {shortId(metric.id)}
        </span>
      )}
      {rect && <Peek metric={metric} rect={rect} id={peekId} />}
    </>
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
