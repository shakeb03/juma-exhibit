import {
  type AgentReply, type Block,
} from "@exhibit/contracts";
import {
  conversationAgency, getTurn, loadClientProfile, loadClientSource, recentTurns, setExecutionSnapshot, validateClientAttachments,
} from "@exhibit/database";
import type { ChatMessage } from "../ai/types.js";
import type { RunContext } from "../exec/context.js";
import { BudgetError } from "../exec/errors.js";
import {
  COMPOSE_INSTRUCTION, availableMetricsNote, brandExcerpts, checksum, historyMessages, openArtifactNote, systemPrompt, userMessageWithAttachments,
} from "./prompts.js";
import { loadBaseArtifact } from "./base.js";
import { composeAnswer, parseArgs } from "./compose.js";
import { commitTurn, fingerprint, type ArtifactCommit } from "./persist.js";
import { MetricRegistry, type RegistryMetric, type RegistryScope } from "./registry.js";
import { ClientToolbox, FINISH_TOOL, GATHER_TOOLS } from "./tools.js";
import { numbersIn, type ValidationContext } from "./validate.js";

const MAX_TOOL_STEPS = 8;
const MAX_TOOL_RESULT_CHARS = 9000;

const compact = (value: unknown) => {
  const json = JSON.stringify(value);
  return json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [result truncated for length]` : json;
};

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
  const loaded = await loadBaseArtifact(db, agencyId, turn.conversationId, turn.referencedVersionId);
  const base = loaded ? { artifactId: loaded.artifactId, kind: loaded.kind, title: loaded.title, versionId: loaded.versionId, version: loaded.version } : null;
  const baseBlocks: Block[] = loaded?.blocks ?? [];
  if (loaded) registry.preload(loaded.metrics, loaded.scopes);
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
  const outcome = await composeAnswer({
    ctx, task: "explain", messages, tools: [...GATHER_TOOLS, FINISH_TOOL], validation, base: base ? { kind: base.kind } : null,
    analysed: () => registry.touched > 0,
    repairHint: "Use only metric ids that tools returned or that are listed as already calculated.",
  });

  if (outcome.type === "clarification") {
    await commitTurn(db, {
      executionId: ctx.executionId, owner: ctx.owner, turnId, conversationId: turn.conversationId, agencyId,
      replyKind: "clarification", replyMessage: outcome.question, replyData: { options: outcome.options }, sourceFingerprint: "",
    });
    return;
  }
  const finished = outcome;
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
