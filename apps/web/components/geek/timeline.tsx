"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { useModelPayload } from "@/lib/hooks";
import type { RowKind, TimelineRow } from "@/lib/timeline";
import { PayloadView } from "./payload-view";

const BAR: Record<RowKind, string> = {
  model: "bg-geek-teal",
  tool: "bg-geek-green",
  check: "bg-geek-amber",
  plan: "bg-geek-muted",
  error: "bg-geek-red",
  info: "bg-geek-muted",
};
const TAG: Record<RowKind, string> = { model: "model", tool: "tool", check: "check", plan: "plan", error: "error", info: "note" };

function ModelPayloads({ callId }: { callId: string }) {
  const payload = useModelPayload(callId);
  if (payload.isLoading) return <p className="font-mono text-xs text-geek-muted" role="status">Loading payloads</p>;
  if (payload.isError || !payload.data) return <p className="font-mono text-xs text-geek-red" role="alert">The payload could not be loaded. It is still stored.</p>;
  return (
    <div className="space-y-2">
      <PayloadView value={payload.data.request} label="Request sent to the model" />
      <PayloadView value={payload.data.response} label="Response returned" />
    </div>
  );
}

function Row({ row, total, open, onToggle }: { row: TimelineRow; total: number; open: boolean; onToggle: () => void }) {
  const left = (row.start / total) * 100;
  // A step too short to see still gets a visible tick.
  const width = Math.max(0.6, (row.duration / total) * 100);
  return (
    <li className="border-b border-geek-border/60 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[1rem_minmax(0,11rem)_1fr_4.5rem] items-center gap-3 px-3 py-2 text-left hover:bg-geek-raised/60"
      >
        {open ? <ChevronDown size={14} className="text-geek-muted" aria-hidden /> : <ChevronRight size={14} className="text-geek-muted" aria-hidden />}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[13px]">
            <span className="rounded bg-geek-raised px-1.5 font-mono text-[10px] uppercase text-geek-muted">{TAG[row.kind]}</span>
            <span className={cn("truncate", row.failed && "text-geek-red")}>{row.label}</span>
          </span>
          {row.detail && <span className="block truncate font-mono text-[11px] text-geek-muted" title={row.detail}>{row.detail}</span>}
        </span>
        <span className="relative h-3 rounded-full bg-geek-bg" aria-hidden>
          <span className={cn("absolute inset-y-0 rounded-full", row.failed ? "bg-geek-red" : BAR[row.kind])} style={{ left: `${Math.min(left, 100 - width)}%`, width: `${width}%` }} />
        </span>
        <span className="tabular text-right font-mono text-xs text-geek-muted">{row.duration > 0 ? formatDuration(row.duration) : "instant"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-9">
          {row.source.type === "model" ? (
            <ModelPayloads callId={row.source.callId} />
          ) : (
            <PayloadView value={row.source.payload} label="Recorded input and result" />
          )}
        </div>
      )}
    </li>
  );
}

/** Every recorded step in order, drawn against the run's wall-clock time. Click a row for its raw payload. */
export function Timeline({ rows, total }: { rows: TimelineRow[]; total: number }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (rows.length === 0) return <p className="px-3 py-4 text-sm text-geek-muted">No steps recorded yet.</p>;
  return (
    <div>
      <div className="flex justify-between px-3 pb-1.5 font-mono text-[11px] text-geek-muted" aria-hidden>
        <span>0 s</span><span>{formatDuration(total)}</span>
      </div>
      <ol aria-label="Run timeline" className="rounded-md border border-geek-border bg-geek-surface">
        {rows.map((row) => <Row key={row.key} row={row} total={total} open={openKey === row.key} onToggle={() => setOpenKey(openKey === row.key ? null : row.key)} />)}
      </ol>
    </div>
  );
}
