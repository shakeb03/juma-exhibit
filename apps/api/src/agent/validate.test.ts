import { describe, expect, it } from "vitest";
import type { AgentReply, ArtifactDraft, CampaignRow } from "@exhibit/contracts";
import { MetricRegistry } from "./registry.js";
import { numbersIn, unverifiedNumbers, validateDraft, validateReply, type ValidationContext } from "./validate.js";

const row = (id: string): CampaignRow => ({
  campaignId: id, campaignName: id, channel: "Pinterest", period: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30",
  currency: "USD", spend: 1000, impressions: 100_000, clicks: 2000, conversions: 40, revenue: 4000,
  attributionWindow: "7d_click", creativeRefId: null,
});

function context(extra: Partial<ValidationContext> = {}): ValidationContext {
  const registry = new MetricRegistry();
  registry.addScope("a", [row("RL-PIN-0901")]);
  return {
    registry,
    knownRefs: new Set(["ridgeline-outfitters:RL-PIN-0901"]),
    allowedNumbers: numbersIn("Adults 28 to 45. Keep recommendations to three or fewer."),
    existingBlockIds: new Set(),
    ...extra,
  };
}

const goodReply: AgentReply = {
  message: "Here is what changed between the two campaigns.",
  statements: [
    { type: "observation", text: "CTR was {{metric:RL-PIN-0901:ctr}} on RL-PIN-0901.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] },
    { type: "hypothesis", text: "The on-location photo may attract more clicks." },
    { type: "recommendation", text: "Test the photo against a flatlay.", reasoning: "It would separate image from audience.", measurement: "Compare clicks per thousand impressions.", limitation: "Needs matched audiences." },
  ],
};

describe("numbers", () => {
  it("allows small counts, years, IDs, dates, and numbers from client context", () => {
    const allowed = numbersIn("Adults 28 to 45");
    expect(unverifiedNumbers("Compare 2 campaigns in 2026, RL-PIN-0901 from 2026-09-07, 7d_click, aged 28 to 45.", allowed)).toEqual([]);
  });
  it("treats calendar dates from the data as facts, not performance claims", () => {
    expect(unverifiedNumbers("The flights overlapped from Sept 14 to 21, and ran Aug 3 to Aug 16.", new Set())).toEqual([]);
    expect(unverifiedNumbers("It ran in September 2026.", new Set())).toEqual([]);
    // A bare number is still a claim.
    expect(unverifiedNumbers("It ran for 14 days.", new Set())).toEqual(["14"]);
  });
  it("flags figures that are not tied to a metric", () => {
    expect(unverifiedNumbers("CTR was 2.4% and spend $12,600 across 1,300,000 impressions.", new Set())).toEqual(["2.4%", "$12,600", "1,300,000"]);
  });
  it("does not treat the unit in 'per 1,000 impressions' as a claim", () => {
    expect(unverifiedNumbers("Conversions per 1,000 impressions fell, and CPM is per 1000 views.", new Set())).toEqual([]);
    expect(unverifiedNumbers("It reached 1,000 clicks.", new Set())).toEqual(["1,000"]);
  });
  it("ignores numbers inside placeholders", () => {
    expect(unverifiedNumbers("CTR was {{metric:A-1:ctr}}.", new Set())).toEqual([]);
  });
});

describe("validateReply", () => {
  it("accepts labelled, evidence-linked statements", () => {
    const result = validateReply(goodReply, context());
    expect(result.problems).toEqual([]);
    expect(result.claims).toEqual({ verified: 1, total: 1 });
  });

  it("rejects an unknown metric ID", () => {
    const reply = { ...goodReply, statements: [{ type: "observation" as const, text: "ROAS was {{metric:ZZ:roas}}.", metricIds: ["metric:ZZ:roas"], sourceRefs: [] }] };
    const result = validateReply(reply, context());
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.claims.verified).toBe(0);
  });

  it("rejects numbers a model typed itself in an observation", () => {
    const reply = { ...goodReply, statements: [{ type: "observation" as const, text: "CTR was 2.4%.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] }] };
    const result = validateReply(reply, context());
    expect(result.problems[0]?.message).toMatch(/Numbers not tied to a metric/);
    expect(result.claims.total).toBe(1);
    expect(result.claims.verified).toBe(0);
  });

  it("rejects causal claims stated as observations but allows them as hypotheses", () => {
    const causal = { ...goodReply, statements: [{ type: "observation" as const, text: "The on-location photo caused the higher clicks.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] }] };
    expect(validateReply(causal, context()).problems.some((p) => /not causes/.test(p.message))).toBe(true);
    const hypothesis: AgentReply = { ...goodReply, statements: [
      goodReply.statements[0]!,
      { type: "hypothesis", text: "The photo may have driven the clicks because it shows real conditions." },
    ] };
    expect(validateReply(hypothesis, context()).problems).toEqual([]);
  });

  it("keeps causal wording out of messages, notes, and paragraphs but allows it in hypotheses", () => {
    const causalMessage = { ...goodReply, message: "The gap comes from click volume." };
    expect(validateReply(causalMessage, context()).problems.some((p) => p.path === "reply.message")).toBe(true);
    const causalNote: AgentReply = { ...goodReply, statements: [goodReply.statements[0]!, { type: "note", text: "Summit Weekend drove more clicks." }] };
    expect(validateReply(causalNote, context()).problems.some((p) => /without causes/.test(p.message))).toBe(true);
    const para = draft([{ type: "paragraph", text: "The photo caused the lift." }, obs(), hyp(), rec()]);
    expect(validateDraft(para, "performance_report", context()).problems.some((p) => /without causes/.test(p.message))).toBe(true);
    const fine: AgentReply = { ...goodReply, statements: [goodReply.statements[0]!, { type: "hypothesis", text: "The gap may come from the photo, because it shows real conditions." }] };
    expect(validateReply(fine, context()).problems).toEqual([]);
  });

  it("rejects an observation with no evidence", () => {
    const reply = { ...goodReply, statements: [{ type: "observation" as const, text: "Performance improved.", metricIds: [], sourceRefs: [] }] };
    expect(validateReply(reply, context()).problems[0]?.message).toMatch(/at least one metric or source/);
  });

  it("rejects a source reference that was never retrieved", () => {
    const reply = { ...goodReply, statements: [{ type: "observation" as const, text: "Noted.", metricIds: [], sourceRefs: ["velvet-static:VS-1"] }] };
    expect(validateReply(reply, context()).problems.some((p) => /not retrieved/.test(p.message))).toBe(true);
  });

  it("requires an observation under any recommendation", () => {
    const reply = { ...goodReply, statements: [goodReply.statements[2]!] };
    expect(validateReply(reply, context()).problems.some((p) => /rest on at least one observation/.test(p.message))).toBe(true);
  });

  it("only warns about proposed figures inside recommendations", () => {
    const reply: AgentReply = { ...goodReply, statements: [
      goodReply.statements[0]!,
      { type: "recommendation", text: "Shift 20% of budget.", reasoning: "Because it limits risk.", measurement: "Track clicks.", limitation: "Short test." },
    ] };
    const result = validateReply(reply, context());
    expect(result.problems).toEqual([]);
    expect(result.warnings.length).toBe(1);
  });
});

const draft = (blocks: ArtifactDraft["blocks"]): ArtifactDraft => ({ action: "create", kind: "performance_report", title: "Report", blocks });
const obs = (key = "o1") => ({ type: "observation" as const, key, text: "CTR was {{metric:RL-PIN-0901:ctr}}.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] });
const hyp = () => ({ type: "hypothesis" as const, text: "The photo may matter.", basedOn: ["o1"], sourceRefs: [] });
const rec = () => ({ type: "recommendation" as const, text: "Test it.", reasoning: "Isolates the image.", basedOn: ["o1"], measurement: "Clicks per 1,000.", limitation: "Needs matched audiences." });

describe("validateDraft", () => {
  it("assigns stable IDs and resolves basedOn keys", () => {
    const result = validateDraft(draft([{ type: "heading", level: 1, text: "Report" }, obs(), hyp(), rec()]), "performance_report", context());
    expect(result.problems).toEqual([]);
    expect(result.blocks).toHaveLength(4);
    const observation = result.blocks.find((b) => b.type === "observation")!;
    const recommendation = result.blocks.find((b) => b.type === "recommendation");
    expect(recommendation?.type === "recommendation" && recommendation.basedOn).toEqual([observation.id]);
    expect(new Set(result.blocks.map((b) => b.id)).size).toBe(4);
    expect(result.claims).toEqual({ verified: 1, total: 1 });
  });

  it("keeps existing block IDs when revising and replaces unknown ones", () => {
    const ctx = context({ existingBlockIds: new Set(["b_existing"]) });
    const result = validateDraft(draft([
      { ...obs(), id: "b_existing" },
      { type: "paragraph", id: "b_invented", text: "Plain text." },
      hyp(), rec(),
    ]), "performance_report", ctx);
    expect(result.problems).toEqual([]);
    expect(result.blocks[0]!.id).toBe("b_existing");
    expect(result.blocks[1]!.id).not.toBe("b_invented");
    expect(result.warnings.some((w) => /does not exist/.test(w.message))).toBe(true);
  });

  it("requires a report to include an observation, a hypothesis, and a recommendation or experiment", () => {
    const result = validateDraft(draft([obs(), hyp()]), "performance_report", context());
    expect(result.problems.some((p) => /needs at least one observation, one hypothesis/.test(p.message))).toBe(true);
    expect(result.blocks).toEqual([]);
  });

  it("rejects a recommendation that cites nothing it is based on", () => {
    const bad = { ...rec(), basedOn: [] as string[] };
    const result = validateDraft(draft([obs(), hyp(), bad]), "performance_report", context());
    expect(result.problems.some((p) => /must cite the observation/.test(p.message))).toBe(true);
  });

  it("rejects dangling basedOn references and duplicate keys", () => {
    const dangling = { ...rec(), basedOn: ["nothing"] };
    expect(validateDraft(draft([obs(), hyp(), dangling]), "performance_report", context()).problems.some((p) => /does not match/.test(p.message))).toBe(true);
    expect(validateDraft(draft([obs("same"), obs("same"), hyp(), rec()]), "performance_report", context()).problems.some((p) => /Duplicate key/.test(p.message))).toBe(true);
  });

  it("rejects unknown scopes in a metric table", () => {
    const table = { type: "metric_table" as const, caption: "Comparison", scopes: [{ label: "X", scopeId: "nope" }], metrics: ["ctr" as const] };
    const result = validateDraft(draft([table, obs(), hyp(), rec()]), "performance_report", context());
    expect(result.problems.some((p) => /Unknown scope/.test(p.message))).toBe(true);
  });

  it("applies the same evidence rules inside artifacts", () => {
    const typed = { ...obs(), text: "CTR was 2.4%." };
    expect(validateDraft(draft([typed, hyp(), rec()]), "performance_report", context()).problems.some((p) => /Numbers not tied/.test(p.message))).toBe(true);
  });
});
