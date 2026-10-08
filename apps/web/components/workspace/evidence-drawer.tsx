"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { useWorkspace } from "@/components/workspace/context";
import { formatInput } from "@/lib/format";
import type { Metric } from "@/lib/types";

const UNIT_LABEL: Record<Metric["unit"], string> = { count: "count", currency: "currency", percent: "percentage", multiple: "multiple", per1k: "per 1,000 impressions" };
const INPUT_LABEL: Record<string, string> = { from: "Earlier value", to: "Later value", clicks: "Clicks", impressions: "Impressions", conversions: "Conversions", spend: "Spend", revenue: "Revenue" };

function unitLine(metric: Metric): string {
  if (metric.change === "relative") return "Relative change between two groups of campaigns";
  if (metric.change === "absolute") return `Absolute change between two groups of campaigns · ${UNIT_LABEL[metric.unit]}`;
  const rows = metric.rowIds.length;
  return `Aggregate of ${rows} campaign${rows === 1 ? "" : "s"} · ${UNIT_LABEL[metric.unit]}`;
}

/** Where the number came from: the claim, the calculation, the rows, and what limits it. Opens inside the main pane. */
export function EvidenceDrawer() {
  const { evidence, closeEvidence, openGeek, activeExecutionId } = useWorkspace();
  const closeRef = useRef<HTMLButtonElement>(null);
  const trigger = evidence?.trigger ?? null;

  useEffect(() => {
    if (!evidence) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEvidence();
      // Keep focus inside the drawer while it is open.
      if (event.key === "Tab") {
        const nodes = document.querySelectorAll<HTMLElement>("#evidence-drawer button, #evidence-drawer a");
        if (nodes.length === 0) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.(); // return focus to the number that opened it
    };
  }, [evidence, closeEvidence, trigger]);

  if (!evidence) return null;
  const { metric } = evidence;
  const unavailable = metric.value === null;

  return (
    <aside
      id="evidence-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="evidence-title"
      className="fade-in absolute inset-y-0 right-0 z-20 flex w-[min(420px,100%)] flex-col border-l border-border-strong bg-surface shadow-float"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-xs font-medium text-text-muted">Evidence</p>
          <h2 id="evidence-title" className="mt-0.5 text-[18px] font-medium">{metric.label}</h2>
        </div>
        <Button ref={closeRef} variant="ghost" compact onClick={closeEvidence} aria-label="Close evidence"><X size={16} aria-hidden /></Button>
      </header>

      <div className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        <section aria-label="Claim">
          <p className="text-xs font-medium text-text-muted">Calculated value</p>
          <p className={`tabular mt-1 text-[28px] font-medium leading-none ${unavailable ? "italic text-text-muted" : ""}`}>{metric.display}</p>
          <p className="mt-1.5 text-xs text-text-muted">
            {unitLine(metric)}
          </p>
          {unavailable && metric.unavailableReason && (
            <p className="mt-3 rounded-[var(--radius-control)] bg-surface-muted p-3 text-text" role="note">
              Unavailable. {metric.unavailableReason}
            </p>
          )}
        </section>

        <section aria-label="Calculation">
          <h3 className="text-xs font-medium text-text-muted">How it was calculated</h3>
          <p className="mt-1.5 rounded-md bg-surface-muted px-3 py-2 font-mono text-[13px]">{metric.formula}</p>
          {Object.keys(metric.inputs).length > 0 && (
            <table className="tabular mt-2 w-full text-left">
              <caption className="sr-only">Inputs to the calculation</caption>
              <thead className="sr-only"><tr><th>Input</th><th>Value</th></tr></thead>
              <tbody>
                {Object.entries(metric.inputs).map(([name, value]) => (
                  <tr key={name} className="border-b border-border last:border-0">
                    <th scope="row" className="py-1.5 pr-3 font-normal text-text-muted">{INPUT_LABEL[name] ?? name}</th>
                    <td className="py-1.5 text-right font-medium">{formatInput(name, value, metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-text-muted">Calculated in code from the campaign rows below. A model wrote the sentence around it, not the number.</p>
        </section>

        <section aria-label="Source rows">
          <h3 className="text-xs font-medium text-text-muted">Source rows</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {[...new Set(metric.rowIds)].map((id) => (
              <li key={id} className="rounded-full bg-surface-muted px-2.5 py-1 font-mono text-xs">{id}</li>
            ))}
          </ul>
        </section>

        <section aria-label="Check">
          <h3 className="text-xs font-medium text-text-muted">Check</h3>
          <p className="mt-1.5">{unavailable ? "Reported as unavailable instead of zero." : "Matches the independently calculated value for these rows."}</p>
          {activeExecutionId && (
            <button type="button" onClick={(event) => { closeEvidence(); openGeek(activeExecutionId, { trigger: event.currentTarget }); }} className="mt-2 text-teal underline underline-offset-2">
              See the run behind this number
            </button>
          )}
        </section>
      </div>
    </aside>
  );
}
