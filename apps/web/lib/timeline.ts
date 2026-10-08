import type { ExecutionEventView, ModelCallView } from "./types";

export type RowKind = "model" | "tool" | "check" | "plan" | "error" | "info";

export interface TimelineRow {
  key: string;
  kind: RowKind;
  label: string;
  detail?: string;
  /** Offset from the start of the run, in ms. */
  start: number;
  /** Zero-duration rows are drawn as ticks. */
  duration: number;
  failed?: boolean;
  /** What opens when the row is expanded. */
  source: { type: "event"; payload: unknown; truncated: boolean } | { type: "model"; callId: string; truncated: boolean };
}

const TOOL_LABEL: Record<string, string> = {
  discover_sources: "Find sources",
  retrieve_campaigns: "Select campaigns",
  read_source: "Read a file",
  read_client_context: "Recall brand context",
  read_creative_references: "Read creative descriptions",
  calculate_metrics: "Calculate metrics",
  compare_metrics: "Compare results",
  ask_clarification: "Ask a question",
  ready_to_answer: "Mark evidence gathered",
};

const TASK_LABEL: Record<string, string> = {
  interpret: "Gather evidence",
  explain: "Write the answer",
  cross_client: "Compare across clients",
  edit_block: "Rewrite one block",
  concepts: "Write concepts",
  vision: "Inspect an image",
  extract: "Extract",
};

/**
 * Merge recorded events and model calls into one ordered timeline. Records are written when a step ends, so each
 * row's start is its recorded time minus its own duration. The overall length is the run's wall-clock time.
 */
export function buildTimeline(
  runStart: number,
  runEnd: number,
  events: ExecutionEventView[],
  calls: ModelCallView[],
): { rows: TimelineRow[]; total: number } {
  const rows: TimelineRow[] = [];
  const offset = (iso: string, duration: number) => Math.max(0, new Date(iso).getTime() - duration - runStart);

  for (const event of events) {
    const duration = event.durationMs ?? 0;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    let kind: RowKind | null = null;
    let label = event.name;
    let detail: string | undefined;
    let failed = false;

    if (event.kind === "tool_call") {
      kind = "tool";
      label = TOOL_LABEL[event.name] ?? event.name;
      detail = event.name;
    } else if (event.kind === "check") {
      kind = "check";
      failed = payload.passed === false;
      label = failed ? "Checks found issues" : "Checks passed";
      detail = typeof payload.numericalClaims === "string" ? payload.numericalClaims : undefined;
    } else if (event.kind === "plan") {
      kind = "plan";
      label = "Plan";
      detail = typeof payload.text === "string" ? payload.text : undefined;
    } else if (event.kind === "error") {
      kind = "error";
      failed = true;
    } else if (event.kind === "artifact") {
      kind = "info";
      label = event.name;
    } else if (event.kind === "progress" && ["Fallback model used", "Asked a clarifying question"].includes(event.name)) {
      kind = "info";
    }
    if (!kind) continue;
    rows.push({
      key: `e${event.id}`, kind, label, detail, start: offset(event.createdAt, duration), duration, failed,
      source: { type: "event", payload: event.payload, truncated: event.payloadTruncated },
    });
  }

  for (const call of calls) {
    const duration = call.durationMs ?? 0;
    const model = (call.actualModel ?? call.requestedModel).replace(/^[^/]+\//, "");
    rows.push({
      key: `m${call.id}`, kind: "model", failed: Boolean(call.error),
      label: `${TASK_LABEL[call.task] ?? call.task}${call.attempt > 1 ? ` (attempt ${call.attempt})` : ""}`,
      detail: call.error ? `${model}: ${call.error}` : model,
      start: offset(call.createdAt, duration), duration,
      source: { type: "model", callId: call.id, truncated: call.payloadTruncated },
    });
  }

  rows.sort((a, b) => a.start - b.start || a.duration - b.duration);
  const total = Math.max(1, runEnd - runStart, ...rows.map((r) => r.start + r.duration));
  return { rows, total };
}

export interface RunMeasures {
  wallMs: number | null;
  modelMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  modelCalls: number;
  failedCalls: number;
  toolCalls: number;
}

/** Measured values for the top of the panel. Cost is "unavailable" unless the gateway reported it for every call. */
export function measure(calls: ModelCallView[], events: ExecutionEventView[], wallMs: number | null): RunMeasures {
  const ok = calls.filter((c) => !c.error);
  const reported = ok.length > 0 && ok.every((c) => c.costUsd !== null);
  return {
    wallMs,
    modelMs: ok.reduce((n, c) => n + (c.durationMs ?? 0), 0),
    inputTokens: ok.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
    outputTokens: ok.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
    costUsd: reported ? ok.reduce((n, c) => n + (c.costUsd ?? 0), 0) : null,
    modelCalls: calls.length,
    failedCalls: calls.length - ok.length,
    toolCalls: events.filter((e) => e.kind === "tool_call").length,
  };
}
