import type { ExecutionEventView, ExecutionView } from "./types";

export interface Step {
  key: string;
  label: string;
  detail?: string;
  state: "done" | "current" | "failed";
}

/** Plain-language names for what the agent did. Internal tool names never reach the main conversation. */
const TOOL_LABEL: Record<string, string> = {
  discover_sources: "Finding sources",
  retrieve_campaigns: "Selecting campaigns",
  read_source: "Reading a file",
  read_client_context: "Recalling brand context",
  read_creative_references: "Reading creative descriptions",
  calculate_metrics: "Calculating metrics",
  compare_metrics: "Comparing results",
  ask_clarification: "Preparing a question",
  ready_to_answer: "Evidence gathered",
};

interface Raw {
  label: string;
  detail?: string;
  failed?: boolean;
}

function toRaw(event: ExecutionEventView): Raw | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (event.kind === "tool_call") {
    const label = TOOL_LABEL[event.name];
    return label ? { label } : null;
  }
  if (event.kind === "check") {
    const passed = payload.passed === true;
    const claims = typeof payload.numericalClaims === "string" ? payload.numericalClaims : undefined;
    // A failed check says so plainly; a verified count next to it would contradict itself.
    return passed ? { label: "Checking calculations", detail: claims } : { label: "Found issues to fix" };
  }
  if (event.kind === "error") return { label: event.name === "Run cancelled" ? "Cancelled" : "Run failed", failed: true };
  if (event.kind === "artifact") return { label: event.name === "Saved artifact version" ? "Saving the artifact" : "Saving the answer" };
  switch (event.name) {
    case "Loaded client context": return { label: "Loading client context" };
    case "Writing the answer": return { label: "Writing the answer" };
    case "Repairing the answer after failed checks": return { label: "Fixing the answer after checks" };
    case "Fallback model used": return { label: "Switched to a backup model" };
    case "Asked a clarifying question": return { label: "Asking a question" };
    default: return null; // run start/finish and per-step bookkeeping are not shown here
  }
}

/** Collapse consecutive repeats ("Calculating metrics" x2) and mark the last step current while running. */
export function stepsFromEvents(events: ExecutionEventView[], status: ExecutionView["status"] | undefined): Step[] {
  const steps: Step[] = [];
  for (const event of events) {
    const raw = toRaw(event);
    if (!raw) continue;
    const last = steps[steps.length - 1];
    if (last && last.label === raw.label && !raw.detail && !raw.failed) {
      const count = Number(last.key.split("x")[1] ?? 1) + 1;
      last.key = `${last.label}x${count}`;
      last.detail = `${count} times`;
      continue;
    }
    steps.push({ key: `${raw.label}x1`, label: raw.label, detail: raw.detail, state: raw.failed ? "failed" : "done" });
  }
  const running = status === "queued" || status === "running" || status === "waiting_to_retry";
  const last = steps[steps.length - 1];
  if (running && last && last.state === "done") last.state = "current";
  if (running && steps.length === 0) steps.push({ key: "queued", label: status === "queued" ? "Waiting to start" : "Starting", state: "current" });
  return steps;
}

/** Latest "x of y verified" string from the checks, for the run overview. */
export function latestClaims(events: ExecutionEventView[]): { text: string; passed: boolean } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind === "check") {
      const payload = (event.payload ?? {}) as { numericalClaims?: string; passed?: boolean };
      if (payload.numericalClaims) return { text: payload.numericalClaims, passed: payload.passed === true };
    }
  }
  return null;
}

export function countSources(events: ExecutionEventView[]): number {
  return events.filter((e) => e.kind === "tool_call" && ["retrieve_campaigns", "read_source", "read_creative_references", "read_client_context", "discover_sources"].includes(e.name)).length;
}

/** The agent's own one-sentence statement of intent, if it wrote one. */
export function planFromEvents(events: ExecutionEventView[]): string | null {
  const event = events.find((e) => e.kind === "plan");
  const text = (event?.payload as { text?: string } | null)?.text;
  return text ? text : null;
}
