import { describe, expect, it } from "vitest";
import type { AgentReply, ArtifactDraft, CampaignRow } from "@exhibit/contracts";
import { MetricRegistry } from "./registry.js";
import { literalNumbersIn } from "./base.js";
import { numbersIn, unverifiedNumbers, validateDraft, validateReply, validateSingleBlock, type ValidationContext } from "./validate.js";

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

  it("keeps causal wording out of text that states data, but allows it in hypotheses and in permission explanations", () => {
    const causalMessage = { ...goodReply, message: "The gap in {{metric:RL-PIN-0901:ctr}} comes from click volume." };
    expect(validateReply(causalMessage, context()).problems.some((p) => p.path === "reply.message")).toBe(true);
    const causalNote: AgentReply = { ...goodReply, statements: [goodReply.statements[0]!, { type: "note", text: "Summit Weekend drove {{metric:RL-PIN-0901:ctr}} more clicks." }] };
    expect(validateReply(causalNote, context()).problems.some((p) => /without causes/.test(p.message))).toBe(true);
    const para = draft([{ type: "paragraph", text: "The photo caused the lift." }, obs(), hyp(), rec()]);
    expect(validateDraft(para, "performance_report", context()).problems.some((p) => /without causes/.test(p.message))).toBe(true);
    const fine: AgentReply = { ...goodReply, statements: [goodReply.statements[0]!, { type: "hypothesis", text: "The gap may come from the photo, because it shows real conditions." }] };
    expect(validateReply(fine, context()).problems).toEqual([]);
    // A refusal explains a permission, not a result.
    const refusal: AgentReply = { message: "I cannot use that client because it has not approved sharing.", statements: [{ type: "note", text: "That client is excluded because sharing is not approved." }] };
    expect(validateReply(refusal, context()).problems).toEqual([]);
  });

  it("rejects an answer that did analysis but states nothing, unless an artifact carries the content", () => {
    const empty: AgentReply = { message: "Done.", statements: [] };
    const analysed = { ...context(), analysed: true };
    expect(validateReply(empty, analysed).problems.some((p) => /stated nothing/.test(p.message))).toBe(true);
    expect(validateReply(empty, { ...analysed, hasArtifact: true }).problems).toEqual([]);
    // A plain conversational reply with no analysis is fine.
    expect(validateReply({ message: "Happy to help. What would you like to look at?", statements: [] }, context()).problems).toEqual([]);
  });

  it("rejects an observation with no evidence", () => {
    const reply = { ...goodReply, statements: [{ type: "observation" as const, text: "Performance improved.", metricIds: [], sourceRefs: [] }] };
    expect(validateReply(reply, context()).problems[0]?.message).toMatch(/at least one metric or source/);
  });

  it("rejects a source reference that was never retrieved", () => {
    const reply = { ...goodReply, statements: [{ type: "observation" as const, text: "Noted.", metricIds: [], sourceRefs: ["velvet-static:VS-1"] }] };
    expect(validateReply(reply, context()).problems.some((p) => /not retrieved/.test(p.message))).toBe(true);
  });

  it("accepts the bare ID at the end of a retrieved reference, but nothing that was never retrieved", () => {
    const ctx = context({ knownRefs: new Set(["marlowe-finch:creative:MF-C03", "marlowe-finch:MF-PIN-0901"]) });
    const cite = (...refs: string[]): AgentReply => ({ ...goodReply, statements: [{ type: "observation", text: "Noted.", metricIds: [], sourceRefs: refs }] });
    expect(validateReply(cite("MF-C03", "MF-PIN-0901", "marlowe-finch:creative:MF-C03"), ctx).problems).toEqual([]);
    expect(validateReply(cite("MF-C09"), ctx).problems.length).toBe(1);
    // A suffix match needs the separator, so a partial ID cannot sneak through.
    expect(validateReply(cite("C03"), ctx).problems.length).toBe(1);
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

describe("single-block validation for comment edits", () => {
  const original = { id: "b1", type: "observation" as const, text: "CTR was {{metric:RL-PIN-0901:ctr}}.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] };

  it("accepts a reworded block and keeps its ID", () => {
    const ctx = context({ existingBlockIds: new Set(["b1"]) });
    const result = validateSingleBlock({ type: "observation", text: "Clicks converted to {{metric:RL-PIN-0901:ctr}} CTR.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] }, original, ctx);
    expect(result.problems).toEqual([]);
    expect(result.block?.id).toBe("b1");
    expect(result.claims).toEqual({ verified: 1, total: 1 });
  });

  it("refuses a type change, an unknown metric, a typed performance number, and a cause", () => {
    const ctx = context({ existingBlockIds: new Set(["b1"]) });
    expect(validateSingleBlock({ type: "paragraph", text: "Hello." }, original, ctx).problems[0]?.message).toMatch(/observation block/);
    expect(validateSingleBlock({ type: "observation", text: "CTR was {{metric:RL-PIN-0901:nope}}.", metricIds: [], sourceRefs: [] }, original, ctx).problems.length).toBeGreaterThan(0);
    expect(validateSingleBlock({ type: "observation", text: "CTR was 4.7% overall.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] }, original, ctx).problems.map((p) => p.message).join()).toMatch(/Numbers not tied/);
    expect(validateSingleBlock({ type: "observation", text: "CTR was {{metric:RL-PIN-0901:ctr}} because of the photo.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] }, original, ctx).problems.length).toBeGreaterThan(0);
  });

  it("keeps which observations a recommendation rests on when the model drops them, and rejects invented ones", () => {
    const rec = { id: "r1", type: "recommendation" as const, text: "Test.", reasoning: "Why.", basedOn: ["b1"], measurement: "M.", limitation: "L." };
    const ctx = context({ existingBlockIds: new Set(["b1", "r1"]) });
    const kept = validateSingleBlock({ type: "recommendation", text: "Run the test.", reasoning: "Why.", basedOn: [], measurement: "M.", limitation: "L." }, rec, ctx);
    expect(kept.block).toMatchObject({ basedOn: ["b1"] });
    expect(validateSingleBlock({ type: "recommendation", text: "Run.", reasoning: "Why.", basedOn: ["ghost"], measurement: "M.", limitation: "L." }, rec, ctx).problems[0]?.message).toMatch(/does not match a block/);
  });
});

describe("numbers a person typed by hand", () => {
  it("are kept when the model returns an unchanged block, and still rejected when the model invents them", () => {
    const paragraph = { action: "update" as const, title: "T", blocks: [{ type: "paragraph" as const, id: "p1", text: "Spend rose 42% per the client call." }, { type: "observation" as const, text: "CTR was {{metric:RL-PIN-0901:ctr}}.", metricIds: ["metric:RL-PIN-0901:ctr"], sourceRefs: [] }] } as ArtifactDraft;
    const strict = context({ existingBlockIds: new Set(["p1"]) });
    expect(validateDraft(paragraph, "client_summary", strict).problems.map((p) => p.message).join()).toMatch(/Numbers not tied/);

    const base = [{ id: "p1", type: "paragraph" as const, text: "Spend rose 42% per the client call." }];
    const allowed = context({ existingBlockIds: new Set(["p1"]), allowedNumbers: numbersIn(literalNumbersIn(base)) });
    expect(validateDraft(paragraph, "client_summary", allowed).problems).toEqual([]);
    const invented = { ...paragraph, blocks: [{ type: "paragraph" as const, id: "p1", text: "Spend rose 77%." }, paragraph.blocks[1]!] } as ArtifactDraft;
    expect(validateDraft(invented, "client_summary", allowed).problems.map((p) => p.message).join()).toMatch(/Numbers not tied/);
  });
});
