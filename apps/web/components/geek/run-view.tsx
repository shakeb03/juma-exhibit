"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useExecutionDetail, useExecutionEvents, useModelCalls } from "@/lib/hooks";
import { buildTimeline, measure } from "@/lib/timeline";
import { PayloadView } from "./payload-view";
import { Timeline } from "./timeline";

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[13px] font-medium text-geek-text">{title}</h3>
        {note && <p className="text-xs text-geek-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-md border border-geek-border bg-geek-surface px-3 py-2">
      <dt className="text-[11px] text-geek-muted">{label}</dt>
      <dd className={cn("tabular mt-0.5 font-mono text-[15px]", tone === "red" && "text-geek-red", tone === "amber" && "text-geek-amber")}>{value}</dd>
    </div>
  );
}

const short = (commit: string | null) => (commit ? commit.slice(0, 7) : "unavailable");

/** Everything recorded about one execution: inputs, permissions, models, timeline, checks, and the output. */
export function RunView({ executionId }: { executionId: string }) {
  const detail = useExecutionDetail(executionId);
  const running = detail.data ? ["queued", "running", "waiting_to_retry"].includes(detail.data.status) : false;
  const events = useExecutionEvents(executionId, running);
  const calls = useModelCalls(executionId);

  if (detail.isLoading || events.isLoading || calls.isLoading) {
    return <div className="space-y-3 p-6" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-geek-surface" />)}</div>;
  }
  if (detail.isError || !detail.data) return <p role="alert" className="p-6 text-sm text-geek-red">This run could not be loaded. It is still stored.</p>;

  const run = detail.data;
  const list = events.data?.events ?? [];
  const modelCalls = calls.data ?? [];
  const start = new Date(run.startedAt ?? run.createdAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const measures = measure(modelCalls, list, run.finishedAt ? end - start : null);
  const { rows, total } = buildTimeline(start, end, list, modelCalls);

  const checks = list.filter((e) => e.kind === "check");
  const failures = list.filter((e) => e.kind === "error");
  const fallbacks = list.filter((e) => e.name === "Fallback model used");
  const failedCalls = modelCalls.filter((c) => c.error);
  const artifacts = list.filter((e) => e.kind === "artifact");
  const lastCheck = checks[checks.length - 1]?.payload as { numericalClaims?: string } | undefined;
  const inputs = run.inputSnapshot;

  return (
    <div className="space-y-7 p-6">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Run time" value={measures.wallMs !== null ? formatDuration(measures.wallMs) : "running"} />
        <Stat label="Model time" value={formatDuration(measures.modelMs)} />
        <Stat label="Tokens in / out" value={`${measures.inputTokens.toLocaleString()} / ${measures.outputTokens.toLocaleString()}`} />
        <Stat label="Cost reported" value={measures.costUsd !== null ? `$${measures.costUsd.toFixed(4)}` : "Unavailable"} />
        <Stat label="Model calls" value={measures.modelCalls} tone={measures.failedCalls > 0 ? "amber" : undefined} />
        <Stat label="Tool calls" value={measures.toolCalls} />
        <Stat label="Numerical claims" value={lastCheck?.numericalClaims?.replace(" verified", "") ?? "Not checked"} />
        <Stat label="Status" value={run.status.replace(/_/g, " ")} tone={run.status === "failed" ? "red" : undefined} />
      </dl>

      <Section title="Timeline" note="Every recorded step, in order. Click a row to see the raw payload.">
        <Timeline rows={rows} total={total} />
      </Section>

      <Section title="What the run was given" note="The request and the context available when it started.">
        <div className="space-y-2 rounded-md border border-geek-border bg-geek-surface p-3 text-[13px]">
          <p><span className="text-geek-muted">Request: </span>{run.request ?? "Unavailable"}</p>
          <p><span className="text-geek-muted">Attachments: </span>{inputs?.attachments?.length ? inputs.attachments.map((a) => a.name).join(", ") : "none"}</p>
          <p><span className="text-geek-muted">Earlier turns read: </span>{inputs?.historyTurnIds?.length ?? 0}</p>
          <p><span className="text-geek-muted">Open artifact: </span>{inputs?.baseArtifact ? `${inputs.baseArtifact.kind.replace(/_/g, " ")}, version ${inputs.baseArtifact.version}` : "none"}</p>
          {inputs?.contextChecksums && (
            <p className="font-mono text-[11px] text-geek-muted">
              stored context checksums: {Object.entries(inputs.contextChecksums).map(([k, v]) => `${k} ${v.slice(0, 8)}`).join(" · ")}
            </p>
          )}
        </div>
      </Section>

      <Section title="Permissions applied">
        <div className="rounded-md border border-geek-border bg-geek-surface p-3 text-[13px]">
          {inputs?.exclusions && inputs.exclusions.length > 0 ? (
            <ul className="space-y-1.5">
              {inputs.exclusions.map((e, i) => (
                <li key={i}><span className="text-geek-red">Excluded</span> · {e.subject}: {e.category.replace(/_/g, " ")}. <span className="text-geek-muted">{e.reason}</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-geek-muted">{inputs?.note ?? "No restrictions applied to this run."}</p>
          )}
        </div>
      </Section>

      <Section title="Models" note={`Routing version ${run.routingVersion ?? "unavailable"}. Requested model, then the model that actually answered.`}>
        {modelCalls.length === 0 ? (
          <p className="text-sm text-geek-muted">No model calls recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-geek-border">
            <table className="tabular w-full min-w-[560px] text-left font-mono text-xs">
              <thead className="bg-geek-surface text-geek-muted">
                <tr><th className="px-3 py-2 font-normal">Task</th><th className="px-3 py-2 font-normal">Requested</th><th className="px-3 py-2 font-normal">Answered by</th><th className="px-3 py-2 text-right font-normal">In / out</th><th className="px-3 py-2 text-right font-normal">Time</th></tr>
              </thead>
              <tbody>
                {modelCalls.map((c) => (
                  <tr key={c.id} className={cn("border-t border-geek-border", c.error && "text-geek-red")}>
                    <td className="px-3 py-1.5">{c.task}{c.attempt > 1 ? ` #${c.attempt}` : ""}</td>
                    <td className="px-3 py-1.5">{c.requestedModel}</td>
                    <td className="px-3 py-1.5">{c.error ? "failed" : (c.actualModel ?? "unavailable")}{c.provider ? <span className="text-geek-muted"> via {c.provider}</span> : null}</td>
                    <td className="px-3 py-1.5 text-right">{c.inputTokens ?? "n/a"} / {c.outputTokens ?? "n/a"}</td>
                    <td className="px-3 py-1.5 text-right">{c.durationMs !== null ? formatDuration(c.durationMs) : "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {run.routingSnapshot && <PayloadView value={run.routingSnapshot} label="Routing configuration snapshot" />}
      </Section>

      <Section title="Checks, retries, and failures">
        {checks.length + failures.length + fallbacks.length + failedCalls.length === 0 ? (
          <p className="text-sm text-geek-muted">Nothing to report.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {checks.map((c) => {
              const p = c.payload as { passed?: boolean; attempt?: number; numericalClaims?: string; problems?: { path: string; message: string }[] };
              return (
                <li key={c.id} className="rounded-md border border-geek-border bg-geek-surface p-3">
                  <p className={p.passed ? "text-geek-green" : "text-geek-amber"}>
                    {p.passed ? "Passed" : "Failed"} · attempt {p.attempt ?? 1} · numerical claims {p.numericalClaims ?? "unavailable"}
                  </p>
                  {p.problems && p.problems.length > 0 && (
                    <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-geek-muted">
                      {p.problems.slice(0, 8).map((problem, i) => <li key={i}>{problem.path}: {problem.message}</li>)}
                      {p.problems.length > 8 && <li>and {p.problems.length - 8} more</li>}
                    </ul>
                  )}
                </li>
              );
            })}
            {fallbacks.map((f) => <li key={f.id} className="rounded-md border border-geek-border bg-geek-surface p-3 text-geek-amber">Fallback model used: {JSON.stringify(f.payload)}</li>)}
            {failedCalls.map((c) => <li key={c.id} className="rounded-md border border-geek-border bg-geek-surface p-3 text-geek-red">Model attempt {c.attempt} failed ({c.requestedModel}): {c.error}</li>)}
            {failures.map((f) => <li key={f.id} className="rounded-md border border-geek-red/40 bg-geek-surface p-3 text-geek-red">{f.name}</li>)}
          </ul>
        )}
      </Section>

      <Section title="Output">
        {artifacts.length === 0 && <p className="text-sm text-geek-muted">No answer or artifact was saved by this run.</p>}
        {artifacts.map((a) => <p key={a.id} className="text-[13px]">{a.name}{a.payload && typeof a.payload === "object" && "version" in (a.payload as object) ? `, version ${(a.payload as { version: number }).version}` : ""}</p>)}
      </Section>

      <p className="border-t border-geek-border pt-4 font-mono text-[11px] leading-relaxed text-geek-muted">
        run {run.id}<br />
        backend commit {short(run.backendCommit)} · started {formatDateTime(run.startedAt ?? run.createdAt)}<br />
        Model reasoning is never recorded. Only the messages sent and the content returned are stored here.
      </p>
    </div>
  );
}
