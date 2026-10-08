"use client";

import { Check, CircleAlert, Code2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { useWorkspace } from "@/components/workspace/context";
import { formatDuration } from "@/lib/format";
import { useExecution, useExecutionEvents } from "@/lib/hooks";
import { countSources, latestClaims, planFromEvents, stepsFromEvents } from "@/lib/steps";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "teal" | "success" | "danger" | "amber" }> = {
  queued: { label: "Waiting to start", tone: "neutral" },
  running: { label: "Running", tone: "teal" },
  waiting_to_retry: { label: "Retrying", tone: "amber" },
  succeeded: { label: "Finished", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** What the system is doing right now and whether it succeeded: real, persisted activity, never mock records. */
function GeekButton({ executionId }: { executionId: string | null }) {
  const { openGeek } = useWorkspace();
  return (
    <button
      type="button"
      onClick={(event) => openGeek(executionId, { trigger: event.currentTarget })}
      className="mt-4 flex min-h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 text-sm text-text-muted hover:bg-surface-muted hover:text-text"
    >
      <Code2 size={15} aria-hidden /> For geeks
    </button>
  );
}

export function RunPanel() {
  const { activeExecutionId } = useWorkspace();
  const execution = useExecution(activeExecutionId);
  const running = execution.data ? ["queued", "running", "waiting_to_retry"].includes(execution.data.status) : Boolean(activeExecutionId);
  const events = useExecutionEvents(activeExecutionId, running);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!activeExecutionId) {
    return (
      <div className="px-5 pb-5">
        <EmptyState title="No run yet">
          Ask a question and each step the agent takes appears here. Slow, but honest.
        </EmptyState>
        <GeekButton executionId={null} />
      </div>
    );
  }
  if (execution.isLoading || !execution.data) {
    return <div className="p-5 text-sm text-text-muted" role="status">Loading run</div>;
  }

  const run = execution.data;
  const list = events.data?.events ?? [];
  const steps = stepsFromEvents(list, run.status);
  const claims = latestClaims(list);
  const plan = planFromEvents(list);
  const status = STATUS_LABEL[run.status] ?? STATUS_LABEL.queued!;
  const started = new Date(run.startedAt ?? run.createdAt).getTime();
  const ended = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  const output =
    run.status === "succeeded" ? "Saved" : run.status === "failed" ? "Nothing saved" : run.status === "cancelled" ? "Nothing saved" : "Not yet";

  return (
    <div className="px-5 pb-5">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="tabular text-xs text-text-muted" aria-label="Elapsed time">{formatDuration(Math.max(0, ended - started))}</span>
      </div>

      {plan && <p className="mt-3 border-l-2 border-teal pl-3 font-serif text-sm italic leading-snug text-text-muted">{plan}</p>}
      <ol className="mt-3 space-y-1.5" aria-live="polite" aria-label="Steps">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {step.state === "done" && <Check size={15} className="text-success" />}
              {step.state === "current" && <Loader2 size={15} className="animate-spin text-teal motion-reduce:animate-none" />}
              {step.state === "failed" && <XCircle size={15} className="text-danger" />}
            </span>
            <span className={step.state === "current" ? "font-medium" : step.state === "failed" ? "text-danger" : "text-text"}>
              {step.label}
              {step.detail && <span className="ml-1.5 text-xs text-text-muted">{step.detail}</span>}
            </span>
            <span className="sr-only">{step.state === "done" ? "done" : step.state === "current" ? "in progress" : "failed"}</span>
          </li>
        ))}
        {steps.length === 0 && <li className="text-sm text-text-muted">Starting</li>}
      </ol>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="text-text-muted">Sources read</dt>
          <dd className="tabular mt-0.5 text-sm font-medium">{countSources(list)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Output</dt>
          <dd className="mt-0.5 text-sm font-medium">{output}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-text-muted">Numerical claims verified</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
            {claims ? (
              <>
                <span className="tabular">{claims.text.replace(" verified", "")}</span>
                {!claims.passed && <Badge tone="amber"><CircleAlert size={12} aria-hidden /> Rechecked</Badge>}
              </>
            ) : (
              <span className="font-normal text-text-muted">Not checked yet</span>
            )}
          </dd>
        </div>
      </dl>

      {run.status === "failed" && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-danger-bg p-3 text-xs text-text" role="alert">
          This run failed and nothing was saved. Your earlier work is unchanged. You can send the request again.
        </p>
      )}
      <GeekButton executionId={activeExecutionId} />
    </div>
  );
}
