import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { submitTurnRequestSchema, type TurnSummary } from "@exhibit/contracts";
import {
  TooManyPendingTurnsError, getExecution, getOrCreateClientConversation, getVersion, getArtifact, listEvents, listTurns,
  listVersions, requestCancel, submitTurn, validateClientAttachments, type Database,
} from "@exhibit/database";
import type { AgentReply, Block } from "@exhibit/contracts";
import { renderBlocks, renderReply } from "../agent/render.js";
import type { RegistryMetric } from "../agent/registry.js";
import type { Config } from "../config.js";

type Session = NonNullable<FastifyRequest["session"]>;

function fail(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}

interface ReplyData {
  reply?: AgentReply;
  metrics?: Record<string, RegistryMetric>;
  claims?: { verified: number; total: number };
  warnings?: unknown[];
  options?: string[];
}

/** Turn a stored reply into what the browser shows: values filled in, metric details kept for evidence. */
function presentReply(kind: string | null, message: string | null, data: ReplyData | null) {
  if (!kind) return null;
  if (kind !== "answer" || !data?.reply || !data.metrics) {
    return { kind, message, options: data?.options ?? [] };
  }
  const metrics = data.metrics;
  const lookup = (id: string) => metrics[id];
  const rendered = renderReply(data.reply, lookup);
  const cited = new Set<string>();
  for (const statement of data.reply.statements) if (statement.type === "observation") statement.metricIds.forEach((id) => cited.add(id));
  const placeholders = JSON.stringify(data.reply).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
  for (const match of placeholders) cited.add(match[1]!);
  return {
    kind,
    ...rendered,
    claims: data.claims ?? null,
    // Evidence for the numbers in this answer: formula, inputs, and the rows behind each.
    evidence: Object.fromEntries([...cited].filter((id) => metrics[id]).map((id) => [id, metrics[id]])),
  };
}

export function conversationRoutes(app: FastifyInstance, options: { db: Database; config: Pick<Config, "commit"> }, done: (err?: Error) => void) {
  const { db, config } = options;
  const session = (request: FastifyRequest): Session => request.session!;

  app.get<{ Params: { clientId: string } }>("/v1/clients/:clientId/conversation", async (request, reply) => {
    const params = z.object({ clientId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid client ID.");
    const { agencyId } = session(request);
    const conversationId = await getOrCreateClientConversation(db, agencyId, params.data.clientId);
    if (!conversationId) return fail(reply, request, 404, "not_found", "Client not found.");
    const turns = await listTurns(db, agencyId, conversationId);
    return {
      conversationId,
      turns: turns.map((turn): TurnSummary => ({
        id: turn.id, seq: turn.seq, userMessage: turn.userMessage, attachmentSourceIds: turn.attachmentSourceIds,
        status: turn.status as TurnSummary["status"], replyKind: turn.replyKind as TurnSummary["replyKind"],
        reply: presentReply(turn.replyKind, turn.replyMessage, turn.replyData as ReplyData | null),
        executionId: turn.executionId, artifact: turn.artifact, createdAt: turn.createdAt.toISOString(),
      })),
    };
  });

  app.post<{ Params: { clientId: string } }>("/v1/clients/:clientId/turns", async (request, reply) => {
    const params = z.object({ clientId: z.string().uuid() }).safeParse(request.params);
    const body = submitTurnRequestSchema.safeParse(request.body);
    const key = request.headers["idempotency-key"];
    if (!params.success || !body.success) return fail(reply, request, 400, "bad_request", "Invalid request.");
    if (typeof key !== "string" || key.length < 8 || key.length > 100) {
      return fail(reply, request, 400, "idempotency_key_required", "An Idempotency-Key header (8 to 100 characters) is required.");
    }
    const { agencyId } = session(request);
    const clientId = params.data.clientId;

    const conversationId = await getOrCreateClientConversation(db, agencyId, clientId);
    if (!conversationId) return fail(reply, request, 404, "not_found", "Client not found.");
    if (!(await validateClientAttachments(db, agencyId, clientId, body.data.attachmentSourceIds))) {
      return fail(reply, request, 400, "invalid_attachment", "One or more attachments are not available for this client.");
    }
    if (body.data.referencedVersionId) {
      const version = await getVersion(db, agencyId, body.data.referencedVersionId);
      if (!version || version.conversationId !== conversationId) {
        return fail(reply, request, 400, "invalid_version", "That artifact version does not belong to this conversation.");
      }
    }

    try {
      const submitted = await submitTurn(db, {
        agencyId, conversationId, idempotencyKey: key, userMessage: body.data.message,
        attachmentSourceIds: [...new Set(body.data.attachmentSourceIds)],
        referencedVersionId: body.data.referencedVersionId, backendCommit: config.commit,
      });
      return reply.status(submitted.duplicate ? 200 : 202).send(submitted);
    } catch (error) {
      if (error instanceof TooManyPendingTurnsError) return fail(reply, request, 429, "too_many_pending", error.message);
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/executions/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid execution ID.");
    const execution = await getExecution(db, session(request).agencyId, params.data.id);
    if (!execution) return fail(reply, request, 404, "not_found", "Execution not found.");
    return {
      id: execution.id, kind: execution.kind, status: execution.status, attempt: execution.attempt, turnId: execution.turnId,
      createdAt: execution.createdAt.toISOString(), startedAt: execution.startedAt?.toISOString() ?? null,
      finishedAt: execution.finishedAt?.toISOString() ?? null,
      error: execution.errorCode ? { code: execution.errorCode, message: execution.errorMessage } : null,
      backendCommit: execution.backendCommit,
    };
  });

  // Ordered events after a cursor, so a refreshed browser reconnects to the same run without refetching history.
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/v1/executions/:id/events", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const query = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).safeParse(request.query);
    if (!params.success || !query.success) return fail(reply, request, 400, "bad_request", "Invalid request.");
    const { agencyId } = session(request);
    const execution = await getExecution(db, agencyId, params.data.id);
    if (!execution) return fail(reply, request, 404, "not_found", "Execution not found.");
    const events = await listEvents(db, agencyId, params.data.id, query.data.after);
    return {
      status: execution.status,
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      nextCursor: events.length ? events[events.length - 1]!.id : query.data.after,
    };
  });

  app.post<{ Params: { id: string } }>("/v1/executions/:id/cancel", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid execution ID.");
    const outcome = await requestCancel(db, session(request).agencyId, params.data.id);
    if (!outcome) return fail(reply, request, 409, "not_cancellable", "This run has already finished.");
    return { status: outcome };
  });

  app.get<{ Params: { id: string } }>("/v1/artifacts/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid artifact ID.");
    const { agencyId } = session(request);
    const artifact = await getArtifact(db, agencyId, params.data.id);
    if (!artifact) return fail(reply, request, 404, "not_found", "Artifact not found.");
    return { artifact, versions: (await listVersions(db, agencyId, artifact.id)).map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })) };
  });

  app.get<{ Params: { id: string } }>("/v1/artifact-versions/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid version ID.");
    const version = await getVersion(db, session(request).agencyId, params.data.id);
    if (!version) return fail(reply, request, 404, "not_found", "Version not found.");
    const evidence = version.evidence as { metrics?: Record<string, RegistryMetric>; scopes?: unknown[] };
    const metrics = evidence.metrics ?? {};
    return {
      id: version.id, artifactId: version.artifactId, version: version.version, kind: version.kind,
      causeKind: version.causeKind, causeTurnId: version.causeTurnId, createdAt: version.createdAt.toISOString(),
      blocks: version.blocks,
      renderedBlocks: renderBlocks(version.blocks as Block[], (id) => metrics[id]),
      metrics, scopes: evidence.scopes ?? [], checks: version.checks,
    };
  });

  done();
}
