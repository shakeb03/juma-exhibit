import {
  finishArgsSchema, type AgentReply, type ArtifactKind, type Block, type FinishArgs,
} from "@exhibit/contracts";
import {
  conversationAgency, getTurn, getVersion, latestArtifactForConversation, loadClientProfile, loadClientSource,
  recentTurns, setExecutionSnapshot, validateClientAttachments, getArtifact,
} from "@exhibit/database";
import type { ChatMessage, ToolCall } from "../ai/types.js";
import type { RunContext } from "../exec/context.js";
import { BudgetError, ValidationFailure } from "../exec/errors.js";
import {
  COMPOSE_INSTRUCTION, availableMetricsNote, brandExcerpts, checksum, historyMessages, openArtifactNote, systemPrompt, userMessageWithAttachments,
} from "./prompts.js";
import { commitTurn, fingerprint, type ArtifactCommit } from "./persist.js";
import { MetricRegistry, type RegistryMetric, type RegistryScope } from "./registry.js";
import { ClientToolbox, FINISH_TOOL, GATHER_TOOLS } from "./tools.js";
import { numbersIn, validateDraft, validateReply, type Claims, type Problem, type ValidationContext } from "./validate.js";

const MAX_TOOL_STEPS = 8;
const MAX_TOOL_RESULT_CHARS = 9000;

const compact = (value: unknown) => {
  const json = JSON.stringify(value);
  return json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [result truncated for length]` : json;
};

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Arguments were not valid JSON." };
  }
}

/**
 * One client conversation turn. Phase one gathers evidence with a fast tool-calling model; phase two
 * has a stronger writing model compose the answer through a single validated `finish` call. Numbers come
 * from code, citations must resolve, and one repair attempt is allowed before the turn fails honestly.
 */
export async function runClientTurn(ctx: RunContext, turnId: string): Promise<void> {
  const { db, agencyId, recorder } = ctx;

  const turn = await getTurn(db, agencyId, turnId);
  if (!turn) throw new Error("Turn not found.");
  const conversation = await conversationAgency(db, agencyId, turn.conversationId);
  if (!conversation?.clientId) throw new Error("Conversation is not a client conversation.");
  const client = await loadClientProfile(db, agencyId, conversation.clientId);
  if (!client) throw new Error("Client not found.");

  // Attachments are rechecked at run time: they must still be this client's ready files.
  if (!(await validateClientAttachments(db, agencyId, client.id, turn.attachmentSourceIds))) {
    throw new Error("An attached file is no longer available.");
  }
  const attachments = [];
  for (const id of turn.attachmentSourceIds) {
    const source = await loadClientSource(db, agencyId, client.id, id);
    if (source) attachments.push({ id: source.id, name: source.name, kind: source.kind });
  }

  // The artifact being worked on: the one the user was looking at, otherwise the latest in this conversation.
  const registry = new MetricRegistry();
  const knownRefs = new Set<string>();
  let base: { artifactId: string; kind: ArtifactKind; title: string; versionId: string; version: number } | null = null;
  let baseBlocks: Block[] = [];
  if (turn.referencedVersionId) {
    const version = await getVersion(db, agencyId, turn.referencedVersionId);
    const artifact = version ? await getArtifact(db, agencyId, version.artifactId) : null;
    if (version && artifact && version.conversationId === turn.conversationId) {
      base = { artifactId: artifact.id, kind: artifact.kind as ArtifactKind, title: artifact.title, versionId: version.id, version: version.version };
      baseBlocks = version.blocks;
      const evidence = version.evidence as { metrics?: Record<string, RegistryMetric>; scopes?: RegistryScope[] };
      registry.preload(evidence.metrics ?? {}, evidence.scopes ?? []);
    }
  } else {
    const latest = await latestArtifactForConversation(db, agencyId, turn.conversationId);
    if (latest) {
      const version = await getVersion(db, agencyId, latest.currentVersionId);
      if (version) {
        base = { artifactId: latest.id, kind: latest.kind as ArtifactKind, title: latest.title, versionId: version.id, version: version.version };
        baseBlocks = version.blocks;
        const evidence = version.evidence as { metrics?: Record<string, RegistryMetric>; scopes?: RegistryScope[] };
        registry.preload(evidence.metrics ?? {}, evidence.scopes ?? []);
      }
    }
  }
  for (const block of baseBlocks) {
    if ("sourceRefs" in block) block.sourceRefs.forEach((ref) => knownRefs.add(ref));
  }

  const history = await recentTurns(db, turn.conversationId, turn.seq, 6);
  const excerpts = brandExcerpts(client);

  // Follow-ups inherit what earlier turns already calculated, so "make that a report" or "what is your
  // evidence" can cite the same verified metrics instead of starting from nothing.
  for (const earlier of history) {
    const data = earlier.replyData as { metrics?: Record<string, RegistryMetric>; scopes?: RegistryScope[] } | null;
    if (data?.metrics) registry.preload(data.metrics, data.scopes ?? []);
    for (const scope of data?.scopes ?? []) {
      for (const campaignId of scope.campaignIds) {
        knownRefs.add(`${client.slug}:${campaignId}`);
        knownRefs.add(campaignId);
      }
    }
  }
  const inherited = availableMetricsNote(registry.allScopes(), registry.comparisons());

  await setExecutionSnapshot(db, ctx.executionId, {
    routingVersion: ctx.routingVersion,
    routingSnapshot: ctx.routing,
    inputSnapshot: {
      client: { id: client.id, slug: client.slug },
      request: turn.userMessage,
      attachments,
      contextChecksums: Object.fromEntries(Object.entries(excerpts).map(([key, text]) => [key, checksum(text)])),
      historyTurnIds: history.map((t) => t.id),
      baseArtifact: base,
      note: "Single-client work uses this client's own data only.",
    },
  });
  await recorder.event("progress", "Loaded client context", { client: client.name, history: history.length, openArtifact: base ? `v${base.version}` : null, attachments: attachments.length });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        systemPrompt(client) +
        (inherited ? `\n\n${inherited}` : "") +
        (base ? `\n\n${openArtifactNote({ artifactId: base.artifactId, kind: base.kind, title: base.title, version: base.version }, baseBlocks)}` : ""),
    },
    ...historyMessages(history),
    { role: "user", content: userMessageWithAttachments(turn.userMessage, attachments) },
  ];

  const toolbox = new ClientToolbox({ db, agencyId, client, attachmentIds: turn.attachmentSourceIds, registry, knownRefs });

  // ---- Phase one: gather evidence ----
  let ready = false;
  for (let step = 1; step <= MAX_TOOL_STEPS && !ready; step++) {
    await ctx.checkpoint();
    await recorder.event("progress", `Gathering evidence (step ${step})`);
    const result = await ctx.models.call("interpret", { messages, tools: GATHER_TOOLS, toolChoice: "required" });
    const calls = result.message.tool_calls ?? [];
    messages.push({ role: "assistant", content: result.message.content, ...(calls.length ? { tool_calls: calls } : {}) });
    // The model's own one-sentence statement of intent, shown before the steps. Only recorded if it wrote one.
    if (step === 1) {
      const fromText = result.message.content?.trim();
      const fromCall = calls
        .map((c) => { const a = parseArgs(c.function.arguments); return a.ok ? (a.value as { plan?: unknown })?.plan : undefined; })
        .find((p): p is string => typeof p === "string" && p.trim().length > 0);
      const text = (fromCall ?? fromText)?.trim();
      if (text) await recorder.event("plan", "Plan", { text: text.slice(0, 400) });
    }
    if (calls.length === 0) break; // the model stopped calling tools; compose with what exists

    for (const call of calls) {
      const parsed = parseArgs(call.function.arguments);
      const outcome = parsed.ok
        ? await recorder.timed("tool_call", call.function.name, parsed.value, () => toolbox.run(call.function.name, parsed.value))
        : { kind: "result" as const, result: { error: parsed.error } };

      if (outcome.kind === "clarification") {
        await recorder.event("progress", "Asked a clarifying question", { question: outcome.question });
        await commitTurn(db, {
          executionId: ctx.executionId, owner: ctx.owner, turnId, conversationId: turn.conversationId, agencyId,
          replyKind: "clarification", replyMessage: outcome.question,
          replyData: { options: outcome.options }, sourceFingerprint: "",
        });
        return;
      }
      if (outcome.kind === "ready") {
        ready = true;
        messages.push({ role: "tool", tool_call_id: call.id, content: "ok" });
        continue;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: compact(outcome.result) });
    }
    // Every tool call in an assistant message needs a response before the next model call.
    if (ready) {
      for (const call of calls) {
        if (!messages.some((m) => m.role === "tool" && m.tool_call_id === call.id)) messages.push({ role: "tool", tool_call_id: call.id, content: "skipped" });
      }
    }
  }
  if (!ready) await recorder.event("progress", "Evidence gathering ended; composing with what was collected");

  // ---- Phase two: compose, validate, repair once ----
  const validation: ValidationContext = {
    registry,
    knownRefs,
    allowedNumbers: numbersIn([excerpts.audience, excerpts.goals, excerpts.constraints, excerpts.standingInstructions, turn.userMessage, ...history.map((t) => t.userMessage)].join("\n")),
    existingBlockIds: new Set(baseBlocks.map((b) => b.id)),
  };

  messages.push({ role: "user", content: COMPOSE_INSTRUCTION });
  let finished: { args: FinishArgs; blocks: Block[]; kind: ArtifactKind | null; claims: Claims; warnings: Problem[] } | null = null;
  let lastProblems: Problem[] = [];

  // One repair for content problems. A reply that simply forgot to call finish is a nudge and does not use it up.
  let contentFailures = 0;
  let nudges = 0;
  for (let attempt = 1; !finished && contentFailures < 2 && nudges < 3; attempt++) {
    await ctx.checkpoint();
    await recorder.event("progress", attempt === 1 ? "Writing the answer" : contentFailures > 0 ? "Repairing the answer after failed checks" : "Asking for the answer again");
    const result = await ctx.models.call("explain", {
      messages,
      tools: [...GATHER_TOOLS, FINISH_TOOL],
      // Not forced: some models reject a forced tool choice. A missing finish call is repaired below.
      toolChoice: "auto",
    });
    const clarify = result.message.tool_calls?.find((c) => c.function.name === "ask_clarification");
    if (clarify) {
      const parsedClarify = parseArgs(clarify.function.arguments);
      const outcome = parsedClarify.ok ? await toolbox.run("ask_clarification", parsedClarify.value) : null;
      if (outcome?.kind === "clarification") {
        await recorder.event("progress", "Asked a clarifying question", { question: outcome.question });
        await commitTurn(db, {
          executionId: ctx.executionId, owner: ctx.owner, turnId, conversationId: turn.conversationId, agencyId,
          replyKind: "clarification", replyMessage: outcome.question, replyData: { options: outcome.options }, sourceFingerprint: "",
        });
        return;
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
          if (a === null || a === undefined || (typeof a === "object" && !(a.blocks && a.blocks.length) && !a.title)) delete value.artifact;
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
      validation.analysed = registry.touched > 0;
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

    if (problems.length === 0 && args) {
      finished = { args, blocks, kind, claims, warnings };
    } else {
      lastProblems = problems;
      if (call) {
        contentFailures++;
        messages.push({
          role: "tool", tool_call_id: call.id,
          content: `Your answer failed checks and was not saved. Fix every problem and call finish again:\n${problems.map((p) => `- ${p.path}: ${p.message}`).join("\n")}`,
        });
        messages.push({
          role: "user",
          content: `Call finish again with the corrected answer. Do not reply with plain text.${args?.artifact ? " Keep the artifact: fix the listed problems inside it rather than dropping it." : ""} Use only metric ids that tools returned or that are listed as already calculated.`,
        });
      } else {
        nudges++;
        messages.push({ role: "user", content: "You must deliver the answer by calling the finish tool. Call it now with your answer." });
      }
    }
  }

  if (!finished) {
    throw new ValidationFailure("The AI output did not pass the evidence checks, so nothing was saved.", lastProblems.map((p) => `${p.path}: ${p.message}`));
  }
  if (ctx.models.attemptCount > 14) throw new BudgetError("model_call_limit", "The run reached its limit of model calls.");

  // ---- Commit ----
  const reply: AgentReply = finished.args.reply;
  const metrics = registry.allMetrics();
  const artifact: ArtifactCommit | undefined =
    finished.args.artifact && finished.kind
      ? {
          action: finished.args.artifact.action,
          kind: finished.kind,
          title: finished.args.artifact.title,
          blocks: finished.blocks,
          targetArtifactId: finished.args.artifact.action === "update" ? base?.artifactId : undefined,
          baseVersionId: base?.versionId,
        }
      : undefined;
  const usedCampaigns = [...new Set(registry.allScopes().flatMap((s) => s.campaignIds))].sort();

  const committed = await commitTurn(db, {
    executionId: ctx.executionId, owner: ctx.owner, turnId, conversationId: turn.conversationId, agencyId,
    replyKind: "answer", replyMessage: reply.message,
    replyData: { reply, metrics, scopes: registry.allScopes(), claims: finished.claims, warnings: finished.warnings },
    artifact,
    evidence: { metrics, scopes: registry.allScopes(), claims: finished.claims, warnings: finished.warnings },
    sourceFingerprint: fingerprint({ campaigns: usedCampaigns, context: Object.values(excerpts).map(checksum) }),
  });
  await recorder.event("artifact", committed ? "Saved artifact version" : "Saved answer", committed ?? { artifact: null });
}
