"use client";

import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { useWorkspace } from "@/components/workspace/context";
import { FilesPanel } from "./files-panel";
import { RunPanel } from "./run-panel";

/**
 * Supporting information: files above, current run below, with a resizable divider.
 * At desktop width it sits beside the main pane; below 1100px it becomes a drawer with Files and Run tabs.
 */
export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useWorkspace();
  const [split, setSplit] = useState(0.55);
  const [tab, setTab] = useState<"files" | "run">("files");
  const columnRef = useRef<HTMLDivElement>(null);

  const onDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const column = columnRef.current;
    if (!column) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = column.getBoundingClientRect();
    const move = (e: PointerEvent) => setSplit(Math.min(0.8, Math.max(0.25, (e.clientY - rect.top) / rect.height)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const filesHeading = <h2 className="px-5 pb-2 pt-5 text-[13px] font-medium text-text-muted">Demo files</h2>;
  const runHeading = <h2 className="px-5 pb-2 pt-4 text-[13px] font-medium text-text-muted">Current run</h2>;

  return (
    <>
      {sidebarOpen && <button className="fixed inset-0 z-30 bg-text/30 desk:hidden" aria-label="Close panel" onClick={() => setSidebarOpen(false)} />}
      <aside
        aria-label="Files and run"
        className={cn(
          "z-40 flex min-h-0 flex-col border-l border-border bg-surface",
          "fixed inset-y-0 right-0 w-[min(380px,92vw)] shadow-float transition-transform duration-200 desk:static desk:w-[30%] desk:min-w-[320px] desk:translate-x-0 desk:shadow-none",
          sidebarOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2 desk:hidden">
          <div role="tablist" aria-label="Panel" className="flex gap-1">
            {(["files", "run"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("min-h-9 rounded-full px-3 text-sm font-medium", tab === t ? "bg-aqua" : "text-text-muted hover:bg-surface-muted")}
              >
                {t === "files" ? "Files" : "Run"}
              </button>
            ))}
          </div>
          <Button variant="ghost" compact onClick={() => setSidebarOpen(false)} aria-label="Close panel"><X size={16} aria-hidden /></Button>
        </div>

        {/* Mobile: one tab at a time. */}
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto desk:hidden">
          {tab === "files" ? <>{filesHeading}<FilesPanel /></> : <>{runHeading}<RunPanel /></>}
        </div>

        {/* Desktop: both, with a resizable divider. */}
        <div ref={columnRef} className="hidden min-h-0 flex-1 flex-col desk:flex">
          <div className="scroll-quiet min-h-0 overflow-y-auto" style={{ flexBasis: `${split * 100}%` }}>
            {filesHeading}
            <FilesPanel />
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize files and run panels"
            aria-valuenow={Math.round(split * 100)}
            aria-valuemin={25}
            aria-valuemax={80}
            tabIndex={0}
            onPointerDown={onDrag}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") setSplit((v) => Math.max(0.25, v - 0.05));
              if (e.key === "ArrowDown") setSplit((v) => Math.min(0.8, v + 0.05));
            }}
            className="h-2 shrink-0 cursor-row-resize border-y border-border bg-surface-muted hover:bg-aqua"
          />
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            {runHeading}
            <RunPanel />
          </div>
        </div>

        <footer className="shrink-0 border-t border-border px-5 py-2.5 text-xs text-text-muted">
          Fictional brands, synthetic data. Built by Shakeb.
        </footer>
      </aside>
    </>
  );
}
