import { describe, expect, it } from "vitest";
import { countSources, latestClaims, planFromEvents, stepsFromEvents } from "./steps";
import type { ExecutionEventView } from "./types";

let id = 0;
const event = (kind: string, name: string, payload: unknown = null): ExecutionEventView => ({
  id: ++id, kind, name, payload, payloadTruncated: false, durationMs: null, createdAt: "2026-10-08T00:00:00Z",
});

describe("stepsFromEvents", () => {
  it("names steps in plain language and hides internal bookkeeping", () => {
    const steps = stepsFromEvents(
      [
        event("progress", "Run started"),
        event("progress", "Loaded client context"),
        event("progress", "Gathering evidence (step 1)"),
        event("tool_call", "retrieve_campaigns"),
        event("tool_call", "calculate_metrics"),
        event("progress", "Run finished"),
      ],
      "succeeded",
    );
    expect(steps.map((s) => s.label)).toEqual(["Loading client context", "Selecting campaigns", "Calculating metrics"]);
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("collapses repeats into a count instead of a wall of lines", () => {
    const steps = stepsFromEvents([event("tool_call", "calculate_metrics"), event("tool_call", "calculate_metrics"), event("tool_call", "calculate_metrics")], "succeeded");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ label: "Calculating metrics", detail: "3 times" });
  });

  it("marks only the last step as current while running, and shows a starting step before any event", () => {
    const running = stepsFromEvents([event("tool_call", "discover_sources"), event("tool_call", "retrieve_campaigns")], "running");
    expect(running.map((s) => s.state)).toEqual(["done", "current"]);
    expect(stepsFromEvents([], "queued")).toEqual([{ key: "queued", label: "Waiting to start", state: "current" }]);
  });

  it("shows a verified count when a check passes, and no contradictory count when it fails", () => {
    const passed = stepsFromEvents([event("check", "Validated answer", { passed: true, numericalClaims: "8 of 8 verified" })], "succeeded");
    expect(passed[0]).toMatchObject({ label: "Checking calculations", detail: "8 of 8 verified" });
    const failed = stepsFromEvents([event("check", "Validated answer", { passed: false, numericalClaims: "8 of 8 verified" })], "running");
    expect(failed[0]!.label).toBe("Found issues to fix");
    expect(failed[0]!.detail).toBeUndefined();
  });

  it("marks failures and honest fallbacks", () => {
    const steps = stepsFromEvents([event("progress", "Fallback model used"), event("error", "Run failed")], "failed");
    expect(steps.map((s) => [s.label, s.state])).toEqual([["Switched to a backup model", "done"], ["Run failed", "failed"]]);
  });
});

describe("canvas runs", () => {
  const resolved = event("progress", "Resolved what this chat may see", { clients: [{ performance: true, creative: true }, { performance: true, creative: false }, { performance: false, creative: false }], explicit: 1, excluded: 2 });
  it("shows applying permissions as a step, with how many things were excluded", () => {
    const steps = stepsFromEvents([resolved], "running");
    expect(steps[0]).toMatchObject({ label: "Applying permissions", detail: "2 excluded" });
  });
  it("counts sources as approved clients plus text on the canvas, not tool calls", () => {
    expect(countSources([resolved])).toBe(3); // two approved clients and one piece of text; the restricted client is not a source
  });
});

describe("run summaries", () => {
  it("reports the latest claim check and the number of sources read", () => {
    const events = [
      event("check", "Validated answer", { passed: false, numericalClaims: "3 of 5 verified" }),
      event("tool_call", "retrieve_campaigns"),
      event("tool_call", "read_source"),
      event("tool_call", "calculate_metrics"),
      event("check", "Validated answer", { passed: true, numericalClaims: "5 of 5 verified" }),
    ];
    expect(latestClaims(events)).toEqual({ text: "5 of 5 verified", passed: true });
    expect(countSources(events)).toBe(2);
    expect(latestClaims([])).toBeNull();
  });
});

describe("planFromEvents", () => {
  it("returns the agent's own one-sentence plan, and nothing when it did not write one", () => {
    expect(planFromEvents([event("progress", "Run started"), event("plan", "Plan", { text: "I'll pull the two latest campaigns and compare them." })])).toBe("I'll pull the two latest campaigns and compare them.");
    expect(planFromEvents([event("progress", "Run started")])).toBeNull();
    // The plan is not a step: it is shown above the steps.
    expect(stepsFromEvents([event("plan", "Plan", { text: "x" })], "running").map((s) => s.label)).toEqual(["Starting"]);
  });
});
