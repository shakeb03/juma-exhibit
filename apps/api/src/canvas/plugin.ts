import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { canvasEdgeSchema, canvasNodeSchema, submitTurnRequestSchema, type CanvasEdge, type CanvasNode, type TurnSummary } from "@exhibit/contracts";
import {
  TooManyPendingTurnsError, getCanvas, getOrCreateCanvasConversation, getVersion, listTurns, loadCanvasRevision, loadCanvasSources,
  loadClientPermissions, saveCanvas, submitTurn, type Database,
} from "@exhibit/database";
import type { Config } from "../config.js";
import { fail, presentReply, type ReplyData } from "../conversations/plugin.js";
import { buildIntelligenceContext } from "../permissions/context.js";
import { describePassport } from "../permissions/passport.js";
import { CanvasError, ContextLimitError } from "../permissions/types.js";

const MAX_NODES = 30;
const MAX_EDGES = 60;
const MAX_CHAT_NODES = 3;

const saveSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  nodes: z.array(canvasNodeSchema).max(MAX_NODES),
  edges: z.array(canvasEdgeSchema).max(MAX_EDGES),
});

/** Reasons a canvas cannot be saved, checked against this agency's own data. Returns null when it is fine. */
async function validateCanvas(db: Database, agencyId: string, nodes: CanvasNode[], edges: CanvasEdge[]): Promise<string | null> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return `Duplicate node ${node.id}.`;
    ids.add(node.id);
  }
  if (nodes.filter((n) => n.type === "chat").length > MAX_CHAT_NODES) return `A canvas can hold at most ${MAX_CHAT_NODES} chat nodes.`;
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return "A connection points at a node that is not on the canvas.";
    if (edge.source === edge.target) return "A node cannot connect to itself.";
    const key = [edge.source, edge.target].sort().join("|");
    if (seen.has(key)) return "Two nodes are already connected.";
    seen.add(key);
  }

  const clientIds = nodes.filter((n) => n.type === "client").map((n) => n.clientId);
  if (clientIds.some((id) => !id)) return "A client node needs a client.";
  if (new Set(clientIds).size !== clientIds.length) return "Each client can appear on the canvas once.";
  const clients = await loadClientPermissions(db, agencyId, clientIds as string[]);
  if (clients.length !== clientIds.length) return "A client on the canvas is not in this workspace.";

  const sourceIds = nodes.filter((n) => n.sourceId).map((n) => n.sourceId!);
  const sources = await loadCanvasSources(db, agencyId, sourceIds);
  if (sources.length !== new Set(sourceIds).size) return "A file on the canvas is not in this workspace.";
  if (sources.some((s) => s.clientId !== null)) return "A client's own files cannot be added to the canvas directly. They are reached only through that client's approvals.";
  return null;
}

/** A turn is stale when the permissions or canvas text it was built on have changed since. Cached per revision. */
async function staleReasons(
  db: Database,
  agencyId: string,
  canvasId: string,
  chatNodeId: string,
  turn: { canvasRevision: number | null; replyData: unknown },
  cache: Map<number, { permission: string; source: string } | null>,
): Promise<string[]> {
  const stored = (turn.replyData as ReplyData | null)?.fingerprints;
  if (!stored || turn.canvasRevision === null) return [];
  if (!cache.has(turn.canvasRevision)) {
    const revision = await loadCanvasRevision(db, agencyId, canvasId, turn.canvasRevision);
    let current: { permission: string; source: string } | null = null;
    if (revision) {
      try {
        const context = await buildIntelligenceContext(db, { agencyId, nodes: revision.nodes, edges: revision.edges, chatNodeId });
        current = { permission: context.permissionFingerprint, source: context.sourceFingerprint };
      } catch (error) {
        if (!(error instanceof CanvasError || error instanceof ContextLimitError)) throw error;
      }
    }
    cache.set(turn.canvasRevision, current);
  }
  const current = cache.get(turn.canvasRevision);
  if (!current) return ["The canvas this was built on can no longer be read."];
  const reasons: string[] = [];
  if (current.permission !== stored.permission) reasons.push("Sharing permissions changed since this was written. Run it again to use the current permissions.");
  if (current.source !== stored.source) reasons.push("Text on the canvas changed since this was written.");
  return reasons;
}

export function canvasRoutes(app: FastifyInstance, options: { db: Database; config: Pick<Config, "commit"> }, done: (err?: Error) => void) {
  const { db, config } = options;
  const agency = (request: FastifyRequest) => request.session!.agencyId;

  app.get("/v1/canvas", async (request, reply) => {
    const canvas = await getCanvas(db, agency(request));
    if (!canvas) return fail(reply, request, 404, "not_found", "No canvas in this workspace.");
    return { canvasId: canvas.id, revision: canvas.revision, nodes: canvas.nodes, edges: canvas.edges, updatedAt: canvas.updatedAt.toISOString() };
  });

  app.put("/v1/canvas", async (request, reply) => {
    const body = saveSchema.safeParse(request.body);
    if (!body.success) return fail(reply, request, 400, "bad_request", `Invalid canvas: ${body.error.issues[0]?.message ?? "check the nodes and connections."}`);
    const problem = await validateCanvas(db, agency(request), body.data.nodes, body.data.edges);
    if (problem) return fail(reply, request, 400, "invalid_canvas", problem);
    const saved = await saveCanvas(db, agency(request), body.data);
    if (!saved) return fail(reply, request, 404, "not_found", "No canvas in this workspace.");
    if (!saved.ok) {
      return reply.status(409).send({
        error: { code: "revision_conflict", message: "The canvas changed since you loaded it. The latest version is included.", requestId: request.id },
        current: { revision: saved.current.revision, nodes: saved.current.nodes, edges: saved.current.edges },
      });
    }
    return { revision: saved.revision };
  });

  // What flows through each connection of one chat node, derived from the same context the model receives.
  app.get<{ Querystring: { chatNodeId?: string } }>("/v1/canvas/passport", async (request, reply) => {
    const query = z.object({ chatNodeId: z.string().min(1) }).safeParse(request.query);
    if (!query.success) return fail(reply, request, 400, "bad_request", "A chat node is required.");
    const canvas = await getCanvas(db, agency(request));
    if (!canvas) return fail(reply, request, 404, "not_found", "No canvas in this workspace.");
    try {
      const context = await buildIntelligenceContext(db, { agencyId: agency(request), nodes: canvas.nodes, edges: canvas.edges, chatNodeId: query.data.chatNodeId });
      return { revision: canvas.revision, passport: describePassport(context, canvas.nodes), exclusions: context.exclusions };
    } catch (error) {
      if (error instanceof CanvasError || error instanceof ContextLimitError) return fail(reply, request, 400, error.code, error.message);
      throw error;
    }
  });

  app.get<{ Params: { nodeId: string } }>("/v1/canvas/chats/:nodeId/conversation", async (request, reply) => {
    const params = z.object({ nodeId: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid chat node.");
    const canvas = await getCanvas(db, agency(request));
    if (!canvas || !canvas.nodes.some((n) => n.id === params.data.nodeId && n.type === "chat")) return fail(reply, request, 404, "not_found", "That chat node is not on the canvas.");
    const conversation = await getOrCreateCanvasConversation(db, agency(request), params.data.nodeId);
    if (!conversation) return fail(reply, request, 404, "not_found", "No canvas in this workspace.");
    const turns = await listTurns(db, agency(request), conversation.id);
    const cache = new Map<number, { permission: string; source: string } | null>();
    const out: TurnSummary[] = [];
    for (const turn of turns) {
      const stale = turn.status === "succeeded" ? await staleReasons(db, agency(request), conversation.canvasId, params.data.nodeId, turn, cache) : [];
      out.push({
        id: turn.id, seq: turn.seq, userMessage: turn.userMessage, attachmentSourceIds: turn.attachmentSourceIds,
        status: turn.status as TurnSummary["status"], replyKind: turn.replyKind as TurnSummary["replyKind"],
        reply: presentReply(turn.replyKind, turn.replyMessage, turn.replyData as ReplyData | null, stale),
        executionId: turn.executionId, artifact: turn.artifact, createdAt: turn.createdAt.toISOString(),
      });
    }
    return { conversationId: conversation.id, canvasRevision: canvas.revision, turns: out };
  });

  app.post<{ Params: { nodeId: string } }>("/v1/canvas/chats/:nodeId/turns", async (request, reply) => {
    const params = z.object({ nodeId: z.string().min(1).max(100) }).safeParse(request.params);
    const body = submitTurnRequestSchema.pick({ message: true, referencedVersionId: true }).safeParse(request.body);
    const key = request.headers["idempotency-key"];
    if (!params.success || !body.success) return fail(reply, request, 400, "bad_request", "Invalid request.");
    if (typeof key !== "string" || key.length < 8 || key.length > 100) {
      return fail(reply, request, 400, "idempotency_key_required", "An Idempotency-Key header (8 to 100 characters) is required.");
    }
    const canvas = await getCanvas(db, agency(request));
    if (!canvas || !canvas.nodes.some((n) => n.id === params.data.nodeId && n.type === "chat")) return fail(reply, request, 404, "not_found", "That chat node is not on the canvas.");
    const conversation = await getOrCreateCanvasConversation(db, agency(request), params.data.nodeId);
    if (!conversation) return fail(reply, request, 404, "not_found", "No canvas in this workspace.");
    if (body.data.referencedVersionId) {
      const version = await getVersion(db, agency(request), body.data.referencedVersionId);
      if (!version || version.conversationId !== conversation.id) return fail(reply, request, 400, "invalid_version", "That artifact version does not belong to this conversation.");
    }
    try {
      // The turn is tied to this exact saved revision, so what it ran against can always be reconstructed.
      const submitted = await submitTurn(db, {
        agencyId: agency(request), conversationId: conversation.id, idempotencyKey: key, userMessage: body.data.message,
        attachmentSourceIds: [], referencedVersionId: body.data.referencedVersionId, canvasRevision: canvas.revision, backendCommit: config.commit,
      });
      return reply.status(submitted.duplicate ? 200 : 202).send({ ...submitted, canvasRevision: canvas.revision });
    } catch (error) {
      if (error instanceof TooManyPendingTurnsError) return fail(reply, request, 429, "too_many_pending", error.message);
      throw error;
    }
  });

  done();
}
