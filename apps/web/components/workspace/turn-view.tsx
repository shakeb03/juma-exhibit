"use client";

import { FileText, Loader2, Paperclip, RotateCcw, XCircle } from "lucide-react";
import { Badge, Button, ErrorNote } from "@/components/ui";
import { useExecutionEvents, useModelCalls } from "@/lib/hooks";
import { KIND_LABEL } from "@/lib/format";
import { planFromEvents, stepsFromEvents } from "@/lib/steps";
import type { SourceSummary, Turn } from "@/lib/types";
import { RichText } from "./rich-text";
import { Statement } from "./statement";
import { useWorkspace } from "./context";
import { TurnXray } from "./xray";

function Steps({ executionId, active }: { executionId: string; active: boolean }) {
  const events = useExecutionEvents(executionId, active);
  const steps = stepsFromEvents(events.data?.events ?? [], active ? "running" : undefined);
  const plan = planFromEvents(events.data?.events ?? []);
  return (
    <div className="space-y-2">
      {plan && <p className="fade-in border-l-2 border-teal pl-3 font-serif text-[15px] italic leading-snug text-text-muted">{plan}</p>}
    <ol className="space-y-1" aria-live="polite" aria-label="What the agent is doing">
      {steps.map((step) => (
        <li key={step.key} className={`flex items-center gap-2 text-sm ${step.state === "current" ? "font-medium text-text" : "text-text-muted"}`}>
          {step.state === "current" ? <Loader2 size={14} className="animate-spin text-teal motion-reduce:animate-none" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-border-strong" aria-hidden />}
          {step.label}
          {step.detail && <span className="text-xs">{step.detail}</span>}
        </li>
      ))}
    </ol>
    </div>
  );
}

export function TurnView({
  turn,
  sources,
  onOpenVersion,
  onFill,
  onRetry,
  onCancel,
}: {
  turn: Turn;
  sources: Map<string, SourceSummary>;
  onOpenVersion: (versionId: string) => void;
  onFill: (text: string) => void;
  onRetry: (turn: Turn) => void;
  onCancel: (executionId: string) => void;
}) {
  const reply = turn.reply;
  const inProgress = turn.status === "queued" || turn.status === "running";
  const metrics = reply?.evidence ?? {};
  const { xray } = useWorkspace();
  const calls = useModelCalls(turn.executionId, xray && turn.status !== "queued" && turn.status !== "running");
  const toolCount = useExecutionEvents(xray ? turn.executionId : null, false).data?.events.filter((e) => e.kind === "tool_call").length ?? 0;

  return (
    <div className="space-y-3">
      {/* The user's request */}
      <div className="flex flex-col items-end gap-1.5">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-aqua/70 px-4 py-2.5 text-[15px]">{turn.userMessage}</div>
        {turn.attachmentSourceIds.length > 0 && (
          <ul className="flex max-w-[88%] flex-wrap justify-end gap-1.5" aria-label="Attached files">
            {turn.attachmentSourceIds.map((id) => {
              const source = sources.get(id);
              return (
                <li key={id}><Badge tone="neutral"><Paperclip size={11} aria-hidden /> {source?.name ?? "File"}</Badge></li>
              );
            })}
          </ul>
        )}
      </div>

      {/* The agent's side: no bubble, readable text, compact cards */}
      <div className="space-y-3 pr-2">
        {inProgress && turn.executionId && (
          <div className="space-y-2">
            <Steps executionId={turn.executionId} active />
            <Button variant="ghost" compact onClick={() => onCancel(turn.executionId!)}><XCircle size={14} aria-hidden /> Cancel</Button>
          </div>
        )}

        {turn.status === "failed" && (
          <ErrorNote
            title="This request did not finish"
            action={<Button compact onClick={() => onRetry(turn)}><RotateCcw size={14} aria-hidden /> Send it again</Button>}
          >
            {turn.reply?.message ?? "Something went wrong. Nothing was saved, and your earlier work is unchanged."}
          </ErrorNote>
        )}
        {turn.status === "cancelled" && <p className="text-sm text-text-muted">Cancelled. Nothing was saved.</p>}

        {reply?.kind === "clarification" && (
          <div className="space-y-2.5">
            <p className="text-[15px] leading-relaxed">{reply.message}</p>
            {reply.options && reply.options.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Quick replies">
                {reply.options.map((option) => (
                  <li key={option}>
                    <button
                      type="button"
                      onClick={() => onFill(option)}
                      className="min-h-9 rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-sm hover:bg-aqua/60"
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-text-muted">Pick a reply to edit it first, or type your own answer below.</p>
          </div>
        )}

        {reply?.kind === "answer" && reply.raw && (
          <div className="space-y-2.5">
            {reply.stale && reply.stale.length > 0 && (
              <div role="status" className="rounded-[var(--radius-control)] border border-amber-dark/40 bg-amber-light p-3 text-sm text-amber-dark">
                <p className="font-medium">This result is out of date</p>
                <p className="mt-0.5">{reply.stale.join(" ")}</p>
                <button type="button" onClick={() => onRetry(turn)} className="mt-2 font-medium underline underline-offset-2">Run it again with the current permissions</button>
              </div>
            )}
            <p className="text-[15px] leading-relaxed"><RichText text={reply.raw.message} metrics={metrics} /></p>
            {reply.raw.statements.map((statement, index) => {
              const key = `${turn.id}-${index}`;
              switch (statement.type) {
                case "observation":
                  return <Statement key={key} kind="observation" variant="inline"><RichText text={statement.text} metrics={metrics} /></Statement>;
                case "hypothesis":
                  return <Statement key={key} kind="hypothesis" variant="inline"><RichText text={statement.text} metrics={metrics} /></Statement>;
                case "recommendation":
                  return (
                    <Statement
                      key={key}
                      kind="recommendation"
                      variant="inline"
                      details={[
                        { label: "Why", content: <RichText text={statement.reasoning} metrics={metrics} /> },
                        { label: "Measure", content: <RichText text={statement.measurement} metrics={metrics} /> },
                        { label: "Limit", content: <RichText text={statement.limitation} metrics={metrics} /> },
                      ]}
                    >
                      <RichText text={statement.text} metrics={metrics} />
                    </Statement>
                  );
                case "note":
                  return <Statement key={key} kind="note" variant="inline"><RichText text={statement.text} metrics={metrics} /></Statement>;
              }
            })}
            {reply.raw.followUp && <p className="text-[15px] text-text-muted"><RichText text={reply.raw.followUp} metrics={metrics} /></p>}

            {turn.artifact && (
              <button
                type="button"
                onClick={() => onOpenVersion(turn.artifact!.versionId)}
                className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-border-strong bg-surface p-3 text-left hover:bg-surface-muted"
              >
                <FileText size={18} className="text-teal" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Artifact saved: version {turn.artifact.version}</span>
                  <span className="block text-xs text-text-muted">Open it beside this conversation</span>
                </span>
              </button>
            )}
            {reply.claims && reply.claims.total > 0 && (
              <p className="tabular text-xs text-text-muted">Numerical claims verified: {reply.claims.verified}/{reply.claims.total}</p>
            )}
            <TurnXray calls={xray ? calls.data : undefined} tools={toolCount} claims={reply.claims} executionId={turn.executionId} />
          </div>
        )}

        {/* Replies from a turn that finished without any answer kind should never be blank. */}
        {turn.status === "succeeded" && !reply && <p className="text-sm text-text-muted">Done.</p>}
      </div>
    </div>
  );
}

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;
