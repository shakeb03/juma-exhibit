import { z } from "zod";
import { finishArgsSchema, type ArtifactKind, type Block, type FinishArgs } from "@exhibit/contracts";
import type { ChatMessage, TaskName, ToolCall, ToolDefinition } from "../ai/types.js";
import type { RunContext } from "../exec/context.js";
import { ValidationFailure } from "../exec/errors.js";
import { validateDraft, validateReply, type Claims, type Problem, type ValidationContext } from "./validate.js";

const clarificationSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z.array(z.string().max(120)).max(5).default([]),
});

export function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Arguments were not valid JSON." };
  }
}

export type ComposeOutcome =
  | { type: "finished"; args: FinishArgs; blocks: Block[]; kind: ArtifactKind | null; claims: Claims; warnings: Problem[] }
  | { type: "clarification"; question: string; options: string[] };

export interface ComposeInput {
  ctx: RunContext;
  task: TaskName;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  validation: ValidationContext;
  /** The artifact being revised, if any. */
  base: { kind: ArtifactKind } | null;
  /** Whether this run calculated or was given metrics, so an answer that states nothing is rejected. */
  analysed: () => boolean;
  /** Extra guidance appended to a repair request. */
  repairHint: string;
}

/**
 * Have a model deliver the answer through a single `finish` call, validate it, and repair once.
 * Content problems get one repair. A reply that forgot to call the tool is nudged separately and does not use it up.
 * The model may instead ask a clarifying question. Throws ValidationFailure when it still does not pass.
 */
export async function composeAnswer(input: ComposeInput): Promise<ComposeOutcome> {
  const { ctx, task, messages, tools, validation, base } = input;
  const { recorder } = ctx;
  let lastProblems: Problem[] = [];
  let contentFailures = 0;
  let nudges = 0;

  for (let attempt = 1; contentFailures < 2 && nudges < 3; attempt++) {
    await ctx.checkpoint();
    await recorder.event("progress", attempt === 1 ? "Writing the answer" : contentFailures > 0 ? "Repairing the answer after failed checks" : "Asking for the answer again");
    // Not forced: some models reject a forced tool choice. A missing finish call is handled as a nudge.
    const result = await ctx.models.call(task, { messages, tools, toolChoice: "auto" });

    const clarify = result.message.tool_calls?.find((c) => c.function.name === "ask_clarification");
    if (clarify) {
      const parsed = parseArgs(clarify.function.arguments);
      const question = parsed.ok ? clarificationSchema.safeParse(parsed.value) : null;
      if (question?.success) {
        await recorder.event("progress", "Asked a clarifying question", { question: question.data.question });
        return { type: "clarification", question: question.data.question, options: question.data.options };
      }
    }

    const call: ToolCall | undefined = result.message.tool_calls?.find((c) => c.function.name === "finish");
    messages.push({ role: "assistant", content: result.message.content, ...(result.message.tool_calls ? { tool_calls: result.message.tool_calls } : {}) });

    const problems: Problem[] = [];
    let args: FinishArgs | null = null;
    if (!call) {
      problems.push({ path: "finish", message: "You must deliver the answer by calling finish." });
    } else if (result.finishReason === "length") {
      problems.push({ path: "finish", message: "Your answer was cut off at the length limit and could not be read. Write a much shorter answer: fewer blocks, one or two sentences each, and a one-sentence reply." });
    } else {
      const parsed = parseArgs(call.function.arguments);
      if (!parsed.ok) problems.push({ path: "finish", message: parsed.error });
      else {
        // Models sometimes send an empty or null artifact when none was asked for. That means "no artifact".
        const value = parsed.value as { artifact?: { blocks?: unknown[]; title?: unknown } | null };
        if (value && typeof value === "object" && "artifact" in value) {
          const a = value.artifact;
          // An artifact with no blocks is no artifact, whatever title it carries.
          if (a === null || a === undefined || (typeof a === "object" && !(Array.isArray(a.blocks) && a.blocks.length))) delete value.artifact;
        }
        const shaped = finishArgsSchema.safeParse(parsed.value);
        if (!shaped.success) problems.push(...shaped.error.issues.map((i) => ({ path: `finish.${i.path.join(".")}`, message: i.message })));
        else args = shaped.data;
      }
    }

    let blocks: Block[] = [];
    let kind: ArtifactKind | null = null;
    let claims: Claims = { verified: 0, total: 0 };
    let warnings: Problem[] = [];
    if (args) {
      validation.analysed = input.analysed();
      validation.hasArtifact = Boolean(args.artifact);
      const replyResult = validateReply(args.reply, validation);
      problems.push(...replyResult.problems);
      claims = replyResult.claims;
      warnings = replyResult.warnings;
      if (args.artifact) {
        if (args.artifact.action === "update" && !base) problems.push({ path: "artifact", message: "There is no open artifact to update. Use action \"create\" with a kind." });
        kind = args.artifact.action === "update" ? (base?.kind ?? null) : (args.artifact.kind ?? null);
        if (!kind) problems.push({ path: "artifact.kind", message: "A new artifact needs a kind." });
        else {
          const draftResult = validateDraft(args.artifact, kind, validation);
          problems.push(...draftResult.problems);
          warnings = [...warnings, ...draftResult.warnings];
          claims = { verified: claims.verified + draftResult.claims.verified, total: claims.total + draftResult.claims.total };
          blocks = draftResult.blocks;
        }
      }
    }

    await recorder.event("check", "Validated answer", {
      attempt, passed: problems.length === 0, problems, warnings,
      numericalClaims: `${claims.verified} of ${claims.total} verified`,
    });

    if (problems.length === 0 && args) return { type: "finished", args, blocks, kind, claims, warnings };

    lastProblems = problems;
    if (call) {
      contentFailures++;
      messages.push({
        role: "tool", tool_call_id: call.id,
        content: `Your answer failed checks and was not saved. Fix every problem and call finish again:\n${problems.map((p) => `- ${p.path}: ${p.message}`).join("\n")}`,
      });
      messages.push({
        role: "user",
        content: `Call finish again with the corrected answer. Do not reply with plain text.${args?.artifact ? " Keep the artifact: fix the listed problems inside it rather than dropping it." : ""} ${input.repairHint}`,
      });
    } else {
      nudges++;
      messages.push({ role: "user", content: "You must deliver the answer by calling the finish tool. Call it now with your answer." });
    }
  }

  throw new ValidationFailure("The AI output did not pass the evidence checks, so nothing was saved.", lastProblems.map((p) => `${p.path}: ${p.message}`));
}
