import { describe, expect, it } from "vitest";
import { buildTimeline, measure } from "./timeline";
import type { ExecutionEventView, ModelCallView } from "./types";

const T0 = Date.parse("2026-10-08T12:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

let id = 0;
const event = (kind: string, name: string, endMs: number, durationMs: number | null, payload: unknown = null): ExecutionEventView => ({
  id: ++id, kind, name, payload, payloadTruncated: false, durationMs, createdAt: at(endMs),
});
const call = (over: Partial<ModelCallView>): ModelCallView => ({
  id: `c${++id}`, task: "interpret", attempt: 1, requestedModel: "anthropic/claude-haiku-5.5", actualModel: "anthropic/claude-haiku-5.5",
  provider: "Anthropic", inputTokens: 100, outputTokens: 20, durationMs: 800, costUsd: 0.001, costEstimated: false, error: null,
  payloadTruncated: false, createdAt: at(1000), ...over,
});

describe("buildTimeline", () => {
  it("places each step from its recorded end time minus its own duration, in order", () => {
    const { rows, total } = buildTimeline(
      T0, T0 + 5000,
      [event("tool_call", "calculate_metrics", 2500, 40), event("check", "Validated answer", 4800, null, { passed: true, numericalClaims: "8 of 8 verified" })],
      [call({ createdAt: at(1000), durationMs: 800 }), call({ task: "explain", requestedModel: "anthropic/claude-sonnet-5.5", actualModel: "anthropic/claude-sonnet-5.5", createdAt: at(4700), durationMs: 2000 })],
    );
    expect(total).toBe(5000);
    expect(rows.map((r) => r.label)).toEqual(["Gather evidence", "Calculate metrics", "Write the answer", "Checks passed"]);
    expect(rows[0]).toMatchObject({ start: 200, duration: 800, kind: "model", detail: "claude-haiku-5.5" });
    expect(rows[1]).toMatchObject({ start: 2460, duration: 40, kind: "tool", detail: "calculate_metrics" });
    expect(rows[2]).toMatchObject({ start: 2700, duration: 2000 });
    expect(rows[3]).toMatchObject({ kind: "check", detail: "8 of 8 verified", failed: false });
  });

  it("marks failed checks and failed model attempts, and labels retries", () => {
    const { rows } = buildTimeline(
      T0, T0 + 3000,
      [event("check", "Validated answer", 2900, null, { passed: false })],
      [call({ error: "Model request failed (503)", actualModel: null, createdAt: at(900), durationMs: 800 }), call({ attempt: 2, createdAt: at(1900), durationMs: 900 })],
    );
    expect(rows.find((r) => r.kind === "check")).toMatchObject({ failed: true, label: "Checks found issues" });
    expect(rows[0]).toMatchObject({ failed: true });
    expect(rows[0]!.detail).toContain("503");
    expect(rows[1]!.label).toBe("Gather evidence (attempt 2)");
  });

  it("hides bookkeeping events but keeps the plan, fallbacks, and artifact saves", () => {
    const { rows } = buildTimeline(
      T0, T0 + 1000,
      [
        event("progress", "Run started", 10, null), event("progress", "Gathering evidence (step 1)", 20, null),
        event("plan", "Plan", 30, null, { text: "I'll compare the two campaigns." }),
        event("progress", "Fallback model used", 40, null), event("artifact", "Saved artifact version", 900, null),
      ],
      [],
    );
    expect(rows.map((r) => r.label)).toEqual(["Plan", "Fallback model used", "Saved artifact version"]);
    expect(rows[0]!.detail).toBe("I'll compare the two campaigns.");
  });

  it("never lets a row start before the run or extend past the total", () => {
    const { rows, total } = buildTimeline(T0, T0 + 1000, [event("tool_call", "read_source", 50, 500)], [call({ createdAt: at(6000), durationMs: 1000 })]);
    expect(rows.every((r) => r.start >= 0)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(6000);
  });
});

describe("measure", () => {
  it("sums only successful calls and reports cost only when the gateway reported it for every one", () => {
    const calls = [call({ costUsd: 0.002 }), call({ costUsd: 0.003, inputTokens: 200, outputTokens: 30 }), call({ error: "boom", costUsd: null, inputTokens: null, outputTokens: null })];
    const m = measure(calls, [event("tool_call", "x", 1, 1), event("tool_call", "y", 2, 1)], 20_000);
    expect(m).toMatchObject({ modelMs: 1600, inputTokens: 300, outputTokens: 50, modelCalls: 3, failedCalls: 1, toolCalls: 2, wallMs: 20_000 });
    expect(m.costUsd).toBeCloseTo(0.005);
  });

  it("says cost is unavailable instead of guessing when any call lacks it", () => {
    expect(measure([call({ costUsd: 0.002 }), call({ costUsd: null })], [], null).costUsd).toBeNull();
    expect(measure([], [], null).costUsd).toBeNull();
  });
});
