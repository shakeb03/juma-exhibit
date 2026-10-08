import {
  blockSchema, type AgentReply, type ArtifactDraft, type ArtifactKind, type Block,
} from "@exhibit/contracts";
import { extractPlaceholders, type MetricRegistry } from "./registry.js";

export interface Problem {
  path: string;
  message: string;
}

export interface Claims {
  /** Placeholders that resolved to a calculated metric. */
  verified: number;
  /** Placeholders plus unverified numeric statements found in factual text. */
  total: number;
}

export interface ValidationContext {
  registry: MetricRegistry;
  /** True when this run calculated metrics, so an answer that states nothing is not acceptable. */
  analysed?: boolean;
  /** True when the same answer includes an artifact that carries the content. */
  hasArtifact?: boolean;
  /** Source references the model may cite (campaigns, creative references, documents). */
  knownRefs: Set<string>;
  /** Numbers that legitimately appear in the client's own context or the user's message. */
  allowedNumbers: Set<string>;
  existingBlockIds: Set<string>;
}

const CAUSAL = /\b(caused|causes|causing|because of|because|due to|driven by|drove|drives|led to|leading to|resulted in|results from|thanks to|proves?|proved|explains why|is why|responsible for|attributable to|comes from|come from|stems from|owing to|on account of|as a result of|the reason)\b/i;

// Calendar dates such as "Sept 14 to 21" come straight from the data and are not performance claims.
const MONTH_DAYS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:\s*(?:to|through|until|[-–])\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{1,2})?\b/gi;

// A standalone number: not part of an ID (RL-PIN-0901), date (2026-09-07), or word (7d, Q3).
const NUMBER = /(?<![\w.-])\$?€?£?\d[\d,]*(?:\.\d+)?%?(?![\w-])/g;

/** Normalize "1,200", "12.50%" to comparable digit strings. */
const digits = (token: string) => token.replace(/[^\d.]/g, "");

export function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER)].map((match) => digits(match[0])));
}

/** Numbers in factual text that are not tied to a metric. Small counts and years are fine. */
export function unverifiedNumbers(text: string, allowed: Set<string>): string[] {
  // Placeholders are verified separately. "per 1,000 impressions" is a unit, not a claim.
  const stripped = text
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\b(?:per|every)\s+1,?000\b/gi, " ")
    .replace(MONTH_DAYS, " ");
  const found: string[] = [];
  for (const match of stripped.matchAll(NUMBER)) {
    const token = match[0];
    const value = digits(token);
    if (/^\d$/.test(value) && !/[%$€£]/.test(token)) continue; // "two", "3 campaigns"
    if (/^(19|20)\d\d$/.test(value)) continue; // years
    if (/^10$/.test(value) && !/[%$€£]/.test(token)) continue;
    if (allowed.has(value)) continue;
    found.push(token);
  }
  return found;
}

class Checker {
  readonly problems: Problem[] = [];
  readonly warnings: Problem[] = [];
  verified = 0;
  total = 0;

  constructor(private readonly ctx: ValidationContext) {}

  /** Check placeholders in a piece of text, and optionally unverified numbers (strict for factual text). */
  text(path: string, text: string, strictNumbers: boolean): void {
    for (const id of extractPlaceholders(text)) {
      this.total++;
      if (this.ctx.registry.get(id)) this.verified++;
      else this.problems.push({ path, message: `Unknown metric "${id}". Use only IDs returned by calculate_metrics or compare_metrics.` });
    }
    const loose = unverifiedNumbers(text, this.ctx.allowedNumbers);
    if (loose.length > 0) {
      if (strictNumbers) {
        this.total += loose.length;
        this.problems.push({ path, message: `Numbers not tied to a metric: ${loose.join(", ")}. Use a {{metric-id}} placeholder.` });
      } else {
        this.warnings.push({ path, message: `Proposed figures are not verified metrics: ${loose.join(", ")}.` });
      }
    }
  }

  /** A reference resolves if it is a retrieved ref, or the bare ID at the end of one ("MF-C03" for "marlowe-finch:creative:MF-C03"). */
  private known(ref: string): boolean {
    if (this.ctx.knownRefs.has(ref)) return true;
    for (const known of this.ctx.knownRefs) if (known.endsWith(`:${ref}`)) return true;
    return false;
  }

  refs(path: string, metricIds: string[], sourceRefs: string[]): void {
    for (const id of metricIds) {
      if (!this.ctx.registry.get(id)) this.problems.push({ path, message: `Unknown metric ID "${id}" in metricIds.` });
    }
    for (const ref of sourceRefs) {
      if (!this.known(ref)) this.problems.push({ path, message: `Source reference "${ref}" was not retrieved in this run.` });
    }
  }

  /**
   * Narrative text that is not a labelled hypothesis must not state causes. Only text that states data is held to
   * this: a refusal such as "I cannot use that client because it has not approved sharing" explains a permission,
   * not a performance result.
   */
  noCause(path: string, text: string, strict = false): void {
    const statesData = strict || extractPlaceholders(text).length > 0 || /\d/.test(text);
    if (statesData && CAUSAL.test(text)) {
      this.problems.push({ path, message: "State what the data shows without causes here (no \"drove\", \"because\", \"comes from\"...). Put any explanation in a hypothesis." });
    }
  }

  observation(path: string, text: string, metricIds: string[], sourceRefs: string[]): void {
    this.text(path, text, true);
    this.refs(path, metricIds, sourceRefs);
    if (metricIds.length + sourceRefs.length + extractPlaceholders(text).length === 0) {
      this.problems.push({ path, message: "An observation must cite at least one metric or source." });
    }
    if (CAUSAL.test(text)) {
      this.problems.push({ path, message: "Observations state what the data shows, not causes. Move the explanation into a hypothesis." });
    }
  }
}

export interface ReplyResult {
  problems: Problem[];
  warnings: Problem[];
  claims: Claims;
}

/** Validate a chat answer: labelled statements, verified numbers, no causal claims as findings. */
export function validateReply(reply: AgentReply, ctx: ValidationContext): ReplyResult {
  const check = new Checker(ctx);
  check.text("reply.message", reply.message, true);
  check.noCause("reply.message", reply.message);
  if (reply.followUp) check.text("reply.followUp", reply.followUp, true);
  reply.statements.forEach((statement, index) => {
    const path = `reply.statements[${index}]`;
    switch (statement.type) {
      case "observation":
        check.observation(path, statement.text, statement.metricIds, statement.sourceRefs);
        break;
      case "hypothesis":
        check.text(path, statement.text, false);
        break;
      case "recommendation":
        check.text(path, statement.text, false);
        check.text(`${path}.reasoning`, statement.reasoning, false);
        break;
      case "note":
        check.text(path, statement.text, true);
        check.noCause(path, statement.text);
        break;
    }
  });
  if (ctx.analysed && !ctx.hasArtifact && reply.statements.length === 0) {
    check.problems.push({ path: "reply.statements", message: "You calculated metrics but stated nothing. Give labelled observations (and a hypothesis or recommendation where useful), or an artifact if one was requested." });
  }
  const hasObservation = reply.statements.some((s) => s.type === "observation");
  if (reply.statements.some((s) => s.type === "recommendation") && !hasObservation) {
    check.problems.push({ path: "reply.statements", message: "A recommendation must rest on at least one observation in the same answer." });
  }
  return { problems: check.problems, warnings: check.warnings, claims: { verified: check.verified, total: check.total } };
}

const newBlockId = () => `b_${Math.random().toString(36).slice(2, 12)}`;

export interface DraftResult extends ReplyResult {
  /** Normalized blocks with stable IDs assigned, ready to store. Empty when there are problems. */
  blocks: Block[];
}

const REQUIREMENTS: Record<ArtifactKind, { need: Block["type"][][]; description: string; minCount?: Partial<Record<Block["type"], number>> }> = {
  performance_report: {
    need: [["observation"], ["hypothesis"], ["recommendation", "experiment"]],
    description: "at least one observation, one hypothesis, and one recommendation or experiment",
  },
  client_summary: { need: [["observation"]], description: "at least one observation" },
  campaign_brief: { need: [["paragraph", "recommendation", "experiment"]], description: "some content beyond headings" },
  campaign_concepts: { need: [["experiment"]], description: "three experiments, each a concept to test", minCount: { experiment: 3 } },
  category_insight: { need: [["observation"], ["hypothesis"]], description: "at least one observation and one hypothesis" },
  experiment_plan: { need: [["experiment"]], description: "at least one experiment" },
};

/**
 * Validate a proposed artifact and assign stable block IDs. Reused IDs must exist in the version being
 * revised; unknown IDs are replaced rather than trusted. Temporary keys are resolved in `basedOn`.
 */
export function validateDraft(draft: ArtifactDraft, kind: ArtifactKind, ctx: ValidationContext): DraftResult {
  const check = new Checker(ctx);

  const keyToId = new Map<string, string>();
  const ids: string[] = [];
  draft.blocks.forEach((block, index) => {
    const reused = block.id && ctx.existingBlockIds.has(block.id) ? block.id : undefined;
    const id = reused ?? newBlockId();
    ids.push(id);
    if (block.key) {
      if (keyToId.has(block.key)) check.problems.push({ path: `artifact.blocks[${index}]`, message: `Duplicate key "${block.key}".` });
      keyToId.set(block.key, id);
    }
    if (block.id && !reused) check.warnings.push({ path: `artifact.blocks[${index}]`, message: `Block ID "${block.id}" does not exist in the version being revised, so a new ID was assigned.` });
  });
  const resolveRef = (ref: string) => keyToId.get(ref) ?? (ctx.existingBlockIds.has(ref) ? ref : undefined);

  const blocks: Block[] = [];
  draft.blocks.forEach((block, index) => {
    const path = `artifact.blocks[${index}]`;
    const basedOn = "basedOn" in block ? block.basedOn.map((ref) => resolveRef(ref)) : [];
    if ("basedOn" in block) {
      block.basedOn.forEach((ref, i) => {
        if (!basedOn[i]) check.problems.push({ path, message: `basedOn "${ref}" does not match any block key or existing block ID.` });
      });
    }

    switch (block.type) {
      case "heading":
        check.text(path, block.text, true);
        break;
      case "paragraph":
        check.text(path, block.text, true);
        // A paragraph in a deliverable states findings, so it is held to the rule whether or not it shows a number.
        check.noCause(path, block.text, true);
        break;
      case "observation":
        check.observation(path, block.text, block.metricIds, block.sourceRefs);
        break;
      case "hypothesis":
        check.text(path, block.text, false);
        check.refs(path, [], block.sourceRefs);
        break;
      case "recommendation":
        check.text(path, block.text, false);
        check.text(`${path}.reasoning`, block.reasoning, false);
        if (basedOn.length === 0) check.problems.push({ path, message: "A recommendation must cite the observation(s) it rests on in basedOn." });
        break;
      case "experiment":
        check.text(path, block.hypothesis, false);
        if (basedOn.length === 0) check.problems.push({ path, message: "An experiment must cite the observation(s) it rests on in basedOn." });
        break;
      case "limitation":
        check.text(path, block.text, false);
        break;
      case "metric_table":
        for (const scope of block.scopes) {
          if (!ctx.registry.scope(scope.scopeId)) check.problems.push({ path, message: `Unknown scope "${scope.scopeId}" in metric table.` });
        }
        break;
    }

    // Drop the draft-only fields; the stored block gets its final ID.
    const rest = Object.fromEntries(Object.entries(block).filter(([field]) => field !== "key" && field !== "id"));
    const stored = { ...rest, id: ids[index]!, ...("basedOn" in block ? { basedOn: basedOn.filter((x): x is string => Boolean(x)) } : {}) };
    const parsed = blockSchema.safeParse(stored);
    if (parsed.success) blocks.push(parsed.data);
    else check.problems.push({ path, message: parsed.error.issues.map((i) => i.message).join("; ") });
  });

  // basedOn on observations-only artifacts is fine; recommendation/experiment targets should be observations.
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const block of blocks) {
    if ((block.type === "recommendation" || block.type === "experiment") && block.basedOn.some((id) => byId.get(id) && byId.get(id)!.type !== "observation")) {
      check.warnings.push({ path: block.id, message: "basedOn normally points at observations." });
    }
  }

  const types = new Set(blocks.map((b) => b.type));
  const requirement = REQUIREMENTS[kind];
  const countOf = (type: Block["type"]) => blocks.filter((b) => b.type === type).length;
  const missingType = !requirement.need.every((anyOf) => anyOf.some((t) => types.has(t)));
  const shortOnCount = Object.entries(requirement.minCount ?? {}).some(([type, min]) => countOf(type as Block["type"]) < (min as number));
  if (missingType || shortOnCount) {
    check.problems.push({ path: "artifact", message: `A ${kind.replace(/_/g, " ")} needs ${requirement.description}.` });
  }

  return {
    problems: check.problems,
    warnings: check.warnings,
    claims: { verified: check.verified, total: check.total },
    blocks: check.problems.length === 0 ? blocks : [],
  };
}
