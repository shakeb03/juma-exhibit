"use client";

import { Check, ChevronDown, ChevronUp, Lock, ShieldCheck, X } from "lucide-react";
import { Badge, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PassportEntry, PassportView } from "@/lib/types";

const STATUS: Record<PassportEntry["status"], { label: string; tone: "success" | "amber" | "danger" | "aqua" }> = {
  approved: { label: "Approved", tone: "success" },
  partial: { label: "Partly approved", tone: "amber" },
  restricted: { label: "Restricted", tone: "danger" },
  explicit: { label: "Added by you", tone: "aqua" },
};

/**
 * The data passport: exactly what the open chat can see through each connection, and what it cannot and why.
 * It is derived from the same context the model receives, so it cannot promise something the system does not do.
 */
export function PassportPanel({
  open, onToggle, loading, error, view, chatTitle,
}: { open: boolean; onToggle: () => void; loading: boolean; error: boolean; view: PassportView | undefined; chatTitle: string }) {
  const entries = view?.passport.entries ?? [];
  const shared = entries.reduce((n, e) => n + e.fieldsShared, 0);
  const restricted = entries.filter((e) => e.status === "restricted").length;

  return (
    <section aria-label="Data passport" className="shrink-0 border-b border-border bg-surface">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-5 py-2 text-left text-sm hover:bg-surface-muted">
        <ShieldCheck size={16} className="text-teal" aria-hidden />
        <span className="font-medium">What “{chatTitle}” can see</span>
        {view && (
          <span className="text-text-muted">
            {entries.length === 0 ? "nothing connected" : `${entries.length} connection${entries.length === 1 ? "" : "s"}, ${shared} field group${shared === 1 ? "" : "s"} shared${restricted ? `, ${restricted} restricted` : ""}`}
          </span>
        )}
        {open ? <ChevronUp size={15} className="ml-auto" aria-hidden /> : <ChevronDown size={15} className="ml-auto" aria-hidden />}
      </button>
      {open && (
        <div className="scroll-quiet fade-in max-h-[44vh] overflow-y-auto border-t border-border px-5 py-4">
          {loading && <div className="space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-16 w-full" /></div>}
          {error && <p role="alert" className="text-sm text-danger">The passport could not be loaded. Nothing was changed.</p>}
          {view && (
            <>
              <p className="mb-3 text-sm text-text-muted">{view.passport.note}</p>
              {entries.length === 0 && <p className="text-sm">Nothing is connected to this chat yet. It can see nothing until you connect a client, a brief, or an idea.</p>}
              <ul className="grid gap-3 lg:grid-cols-2">
                {entries.map((entry) => {
                  const status = STATUS[entry.status];
                  return (
                    <li key={`${entry.nodeId}-${entry.title}`} className={cn("rounded-[var(--radius-control)] border p-3.5", entry.status === "restricted" ? "border-danger/40 bg-danger-bg/50" : "border-border")}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{entry.title}</p>
                        <Badge tone={status.tone}>{entry.status === "restricted" && <Lock size={11} aria-hidden />}{status.label}</Badge>
                      </div>
                      {entry.fieldsShared === 0 && <p className="mt-1.5 text-sm font-medium text-danger">0 fields shared</p>}
                      {entry.included.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[13px]" aria-label="Shared">
                          {entry.included.map((line) => <li key={line} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden /><span>{line}</span></li>)}
                        </ul>
                      )}
                      {entry.excluded.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[13px]" aria-label="Not shared">
                          {entry.excluded.map((line, i) => <li key={line} className="flex gap-1.5 text-text-muted"><X size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden /><span><span className="text-text">{line}.</span> {entry.reasons[i] ?? ""}</span></li>)}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 rounded-[var(--radius-control)] bg-surface-muted p-3.5">
                <p className="text-xs font-medium text-text-muted">Never shared from any client, whatever is approved</p>
                <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                  {view.passport.neverShared.map((line) => <li key={line} className="flex gap-1.5"><X size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />{line}</li>)}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
