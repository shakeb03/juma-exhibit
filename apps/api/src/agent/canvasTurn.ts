import type { AgentReply, Block } from "@exhibit/contracts";
import {
  canvasConversationInfo, getTurn, loadCanvasRevision, recentTurns, setExecutionSnapshot,
} from "@exhibit/database";
import type { ChatMessage } from "../ai/types.js";
import type { RunContext } from "../exec/context.js";
import { BudgetError, ContextChangedError } from "../exec/errors.js";
import { buildIntelligenceContext, contextChanges, toModelContext, type BuildOptions } from "../permissions/context.js";
import { buildPatternRegistry, describePatternRegistry } from "../permissions/patternRegistry.js";
import { CanvasError } from "../permissions/types.js";
import { loadBaseArtifact } from "./base.js";
import { composeAnswer } from "./compose.js";
import { commitTurn, fingerprint, type ArtifactCommit } from "./persist.js";
import { canvasSystemPrompt, historyMessages } from "./prompts.js";
import type { RegistryMetric, RegistryScope } from "./registry.js";
import { ASK_CLARIFICATION_TOOL, FINISH_TOOL } from "./tools.js";
import { numbersIn, type ValidationContext } from "./validate.js";

const COMPOSE_INSTRUCTION = `Answer now by calling finish (or ask_clarification if the request is genuinely ambiguous).
- Use only the approved context and the citable metric ids above. State what is excluded or missing plainly.
- Observations cite metric ids and state no causes; explanations go in hypotheses; experiments carry reasoning, measurement, and limits and rest on observations.
- If you create an artifact, give new blocks a key and reference observation keys in basedOn.`;

/**
 * One turn of a chat node on the intelligence canvas. The model is given the permission filter's output and
 * nothing else: no tools can reach client data, so what it can say is bounded by what each client approved.
 * Permissions are rechecked before the result is saved, and a result built on changed permissions is refused.
 */
export async function runCanvasTurn(ctx: RunContext, turnId: string): Promise<void> {
  const { db, agencyId, recorder } = ctx;

  const turn = await getTurn(db, agencyId, turnId);
  if (!turn) throw new Error("Turn not found.");
  const conversation = await canvasConversationInfo(db, agencyId, turn.conversationId);
  if (!conversation) throw new Error("Conversation is not a canvas chat.");
  if (turn.canvasRevision === null) throw new CanvasError("invalid_canvas", "This request has no canvas revision.");
  const revision = await loadCanvasRevision(db, agencyId, conversation.canvasId, turn.canvasRevision);
  if (!revision) throw new CanvasError("invalid_canvas", "That canvas revision no longer exists.");

  // Permissions are resolved here, at run time, from the current sharing flags. Connections only select candidates.
  const options: BuildOptions = { agencyId, nodes: revision.nodes, edges: revision.edges, chatNodeId: conversation.chatNodeId };
  const context = await buildIntelligenceContext(db, options);
  for (const exclusion of context.exclusions) {
    await recorder.event("permission", `${exclusion.subject}: ${exclusion.category.replace(/_/g, " ")} excluded`, { reason: exclusion.reason });
  }

  const registry = buildPatternRegistry(context);
  const loaded = await loadBaseArtifact(db, agencyId, turn.conversationId, turn.referencedVersionId);
  if (loaded) registry.preload(loaded.metrics, loaded.scopes);
  const history = await recentTurns(db, turn.conversationId, turn.seq, 6);
  // Earlier answers' metrics stay citable, but only ones that still resolve under today's permissions are listed.
  const knownRefs = new Set(context.refs);

  await setExecutionSnapshot(db, ctx.executionId, {
    routingVersion: ctx.routingVersion,
    routingSnapshot: ctx.routing,
    inputSnapshot: {
      request: turn.userMessage,
      canvasRevision: turn.canvasRevision,
      connected: revision.nodes.filter((n) => context.connectedNodeIds.includes(n.id)).map((n) => ({ id: n.id, type: n.type, title: n.title })),
      exclusions: context.exclusions,
      fingerprints: { permission: context.permissionFingerprint, source: context.sourceFingerprint },
      baseArtifact: loaded ? { artifactId: loaded.artifactId, version: loaded.version, kind: loaded.kind } : null,
      note: "Cross-client work uses only information each client approved for this purpose.",
    },
  });
  await recorder.event("progress", "Resolved what this chat may see", {
    clients: context.clients.map((c) => ({ name: c.name, performance: c.performanceApproved, creative: c.creativeApproved })),
    explicit: context.explicit.length,
    excluded: context.exclusions.length,
  });

  const notAvailable = context.exclusions.map((e) => `- ${e.subject}: ${e.category.replace(/_/g, " ")}. ${e.reason}`).join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: canvasSystemPrompt(JSON.stringify(toModelContext(context)), describePatternRegistry(registry), notAvailable) },
    ...historyMessages(history),
    { role: "user", content: turn.userMessage },
    { role: "user", content: COMPOSE_INSTRUCTION },
  ];

  const validation: ValidationContext = {
    registry,
    knownRefs,
    allowedNumbers: numbersIn([turn.userMessage, ...history.map((t) => t.userMessage), ...context.explicit.map((e) => e.text)].join("\n")),
    existingBlockIds: new Set((loaded?.blocks ?? []).map((b: Block) => b.id)),
  };

  const outcome = await composeAnswer({
    ctx, task: "cross_client", messages, tools: [ASK_CLARIFICATION_TOOL, FINISH_TOOL],
    validation, base: loaded ? { kind: loaded.kind } : null,
    // Approved patterns are always on the table, so an answer that states nothing is not acceptable.
    analysed: () => context.clients.some((c) => c.campaigns.length > 0),
    repairHint: "Use only the scope ids listed under CITABLE METRICS and the references in the approved context.",
  });

  // Recheck before saving: if sharing or canvas text changed while the model worked, this result must not be kept.
  const changes = await contextChanges(db, context, options);
  if (changes.length > 0) throw new ContextChangedError(changes);

  if (outcome.type === "clarification") {
    await commitTurn(db, {
      executionId: ctx.executionId, owner: ctx.owner, turnId, conversationId: turn.conversationId, agencyId,
      replyKind: "clarification", replyMessage: outcome.question,
      replyData: { options: outcome.options, fingerprints: { permission: context.permissionFingerprint, source: context.sourceFingerprint } },
      sourceFingerprint: "", permissionFingerprint: context.permissionFingerprint,
    });
    return;
  }
  if (ctx.models.attemptCount > 14) throw new BudgetError("model_call_limit", "The run reached its limit of model calls.");

  const reply: AgentReply = outcome.args.reply;
  const metrics: Record<string, RegistryMetric> = registry.allMetrics();
  const scopes: RegistryScope[] = registry.allScopes();
  const artifact: ArtifactCommit | undefined =
    outcome.args.artifact && outcome.kind
      ? {
          action: outcome.args.artifact.action,
          kind: outcome.kind,
          title: outcome.args.artifact.title,
          blocks: outcome.blocks,
          targetArtifactId: outcome.args.artifact.action === "update" ? loaded?.artifactId : undefined,
          baseVersionId: loaded?.versionId,
        }
      : undefined;
  const fingerprints = { permission: context.permissionFingerprint, source: context.sourceFingerprint };

  const committed = await commitTurn(db, {
    executionId: ctx.executionId, owner: ctx.owner, turnId, conversationId: turn.conversationId, agencyId,
    replyKind: "answer", replyMessage: reply.message,
    replyData: { reply, metrics, scopes, claims: outcome.claims, warnings: outcome.warnings, fingerprints, canvas: { revision: turn.canvasRevision, chatNodeId: conversation.chatNodeId } },
    artifact,
    evidence: { metrics, scopes, claims: outcome.claims, warnings: outcome.warnings },
    sourceFingerprint: fingerprint({ source: context.sourceFingerprint, refs: context.refs }),
    permissionFingerprint: context.permissionFingerprint,
  });
  await recorder.event("artifact", committed ? "Saved artifact version" : "Saved answer", committed ?? { artifact: null });
}
