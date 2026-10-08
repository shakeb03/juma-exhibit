"use client";

import { ChevronLeft, ChevronRight, Code2, ListTree, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/components/workspace/context";
import { CodeBrowser } from "./code-browser";
import { RunView } from "./run-view";

/**
 * "For geeks": a panel above the workspace, deliberately a different mode (dark, monospaced, technical).
 * It opens at the turn being viewed and closing it returns to exactly where the user was.
 */
export function GeekPanel() {
  const { geek, closeGeek, setGeekExecution, setGeekTab, geekTurns } = useWorkspace();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = geek.trigger;

  useEffect(() => {
    if (!geek.open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeGeek(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [geek.open, closeGeek, trigger]);

  if (!geek.open) return null;

  const index = geekTurns.findIndex((t) => t.executionId === geek.executionId);
  const current = index >= 0 ? geekTurns[index] : null;
  const go = (delta: number) => {
    const next = geekTurns[index + delta];
    if (next) setGeekExecution(next.executionId);
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button className="absolute inset-0 bg-black/50" aria-label="Back to workspace" onClick={closeGeek} tabIndex={-1} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="geek-title"
        className="fade-in relative flex h-full w-[min(1040px,96vw)] flex-col border-l border-geek-border bg-geek-bg text-geek-text shadow-float"
      >
        <header className="shrink-0 border-b border-geek-border px-5 pb-0 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="geek-title" className="text-[20px] font-medium">For geeks</h2>
              <p className="font-serif text-sm italic text-geek-muted">The receipts, in detail.</p>
            </div>
            <button ref={closeButton} type="button" onClick={closeGeek} className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-geek-border px-3 text-sm hover:bg-geek-raised">
              <X size={15} aria-hidden /> Back to workspace
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="tablist" aria-label="View" className="flex gap-1">
              {([["run", "Run", ListTree], ["code", "Source code", Code2]] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={geek.tab === id}
                  onClick={() => setGeekTab(id)}
                  className={cn("flex min-h-9 items-center gap-1.5 rounded-t-md border-b-2 px-3 text-sm", geek.tab === id ? "border-geek-teal text-geek-teal" : "border-transparent text-geek-muted hover:text-geek-text")}
                >
                  <Icon size={15} aria-hidden /> {label}
                </button>
              ))}
            </div>
            {geek.tab === "run" && geekTurns.length > 1 && (
              <div className="ml-auto flex items-center gap-1.5 pb-1" role="group" aria-label="Turns">
                <button type="button" onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous turn" className="grid h-8 w-8 place-items-center rounded border border-geek-border hover:bg-geek-raised disabled:opacity-40"><ChevronLeft size={15} aria-hidden /></button>
                <span className="tabular min-w-[8rem] truncate text-center font-mono text-xs text-geek-muted" aria-live="polite">
                  {current ? `Turn ${current.seq} of ${geekTurns[geekTurns.length - 1]!.seq}` : "Turn"}
                </span>
                <button type="button" onClick={() => go(1)} disabled={index < 0 || index >= geekTurns.length - 1} aria-label="Next turn" className="grid h-8 w-8 place-items-center rounded border border-geek-border hover:bg-geek-raised disabled:opacity-40"><ChevronRight size={15} aria-hidden /></button>
              </div>
            )}
          </div>
          {geek.tab === "run" && current && <p className="truncate pb-2.5 pt-1 text-sm text-geek-muted" title={current.label}>“{current.label}”</p>}
        </header>

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto" role="tabpanel">
          {geek.tab === "code" ? (
            <CodeBrowser />
          ) : geek.executionId ? (
            <RunView key={geek.executionId} executionId={geek.executionId} />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-sm text-geek-muted">
              <p>No run to show yet. Ask something in a workspace, then open this panel to see what happened.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
