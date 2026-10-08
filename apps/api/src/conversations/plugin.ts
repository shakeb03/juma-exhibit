import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { submitTurnRequestSchema, type TurnSummary } from "@exhibit/contracts";
import {
  TooManyPendingTurnsError, executionForVersion, getExecutionDetail, getModelCallPayload, listModelCalls, loadClientProfile, loadClientSources, getExecution, getOrCreateClientConversation, getVersion, getArtifact, listEvents, listTurns,
  listVersions, requestCancel, submitTurn, validateClientAttachments, type Database,
} from "@exhibit/database";
import type { AgentReply, Block } from "@exhibit/contracts";
import { renderBlocks, renderReply } from "../agent/render.js";
import { formatMetric, type RegistryMetric } from "../agent/registry.js";
import type { Config } from "../config.js";

type Session = NonNullable<FastifyRequest["session"]>;

function fail(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}

/** A metric as the browser needs it: the calculation record plus the display string. */
const withDisplay = (metric: RegistryMetric) => ({ ...metric, display: formatMetric(metric) });

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
    // The same reply with {{metric-id}} placeholders intact, so each number can be shown as an inspectable element.
    raw: data.reply,
    claims: data.claims ?? null,
    // Evidence for the numbers in this answer: formula, inputs, and the rows behind each.
    evidence: Object.fromEntries([...cited].filter((id) => metrics[id]).map((id) => [id, withDisplay(metrics[id]!)])),
  };
}

export function conversationRoutes(app: FastifyInstance, options: { db: Database; config: Pick<Config, "commit"> }, done: (err?: Error) => void) {
  const { db, config } = options;
  const session = (request: FastifyRequest): Session => request.session!;

  // The context the workspace already holds for a client, so nobody has to re-explain the brand.
  app.get<{ Params: { clientId: string } }>("/v1/clients/:clientId", async (request, reply) => {
    const params = z.object({ clientId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid client ID.");
    const { agencyId } = session(request);
    const profile = await loadClientProfile(db, agencyId, params.data.clientId);
    if (!profile) return fail(reply, request, 404, "not_found", "Client not found.");
    const sources = await loadClientSources(db, agencyId, profile.id);
    const periods = await db.query(
      "select min(period) as first, max(period) as last from campaign_rows where agency_id = $1 and client_id = $2",
      [agencyId, profile.id],
    );
    return {
      ...profile,
      reportingPeriod: periods.rows[0]?.last ? { first: periods.rows[0].first, last: periods.rows[0].last } : null,
      sources: sources.map(({ id, kind, name, mimeType, sizeBytes, status }) => ({ id, kind, name, mimeType, sizeBytes, status })),
    };
  });

  app.get<{ Params: { sourceId: string } }>("/v1/sources/:sourceId/preview", async (request, reply) => {
    const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid source ID.");
    const { agencyId } = session(request);
    const result = await db.query(
      "select id, client_id, kind, name, mime_type, size_bytes, extracted_text from sources where id = $1 and agency_id = $2",
      [params.data.sourceId, agencyId],
    );
    const row = result.rows[0];
    if (!row) return fail(reply, request, 404, "not_found", "File not found.");
    const text: string = row.extracted_text ?? "";
    const limit = 6000;
    return {
      id: row.id, clientId: row.client_id, kind: row.kind, name: row.name, mimeType: row.mime_type, sizeBytes: row.size_bytes,
      text: text.slice(0, limit), truncated: text.length > limit, totalChars: text.length,
    };
  });

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

  // The technical record of one run: inputs, routing, commit, and timing.
  app.get<{ Params: { id: string } }>("/v1/executions/:id/detail", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid execution ID.");
    const detail = await getExecutionDetail(db, session(request).agencyId, params.data.id);
    if (!detail) return fail(reply, request, 404, "not_found", "Execution not found.");
    return {
      ...detail,
      createdAt: detail.createdAt.toISOString(),
      startedAt: detail.startedAt?.toISOString() ?? null,
      finishedAt: detail.finishedAt?.toISOString() ?? null,
    };
  });

  // One row per model attempt: model, tokens, latency, cost. Payload bodies are fetched per call.
  app.get<{ Params: { id: string } }>("/v1/executions/:id/model-calls", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid execution ID.");
    const { agencyId } = session(request);
    if (!(await getExecution(db, agencyId, params.data.id))) return fail(reply, request, 404, "not_found", "Execution not found.");
    const calls = await listModelCalls(db, agencyId, params.data.id);
    return { calls: calls.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) };
  });

  app.get<{ Params: { id: string } }>("/v1/model-calls/:id/payload", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid call ID.");
    const payload = await getModelCallPayload(db, session(request).agencyId, params.data.id);
    if (!payload) return fail(reply, request, 404, "not_found", "Model call not found.");
    return payload;
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
    // The run that produced this version, so the UI can say which models wrote it (X-ray).
    const executionId = await executionForVersion(db, session(request).agencyId, version.id);
    const calls = executionId ? await listModelCalls(db, session(request).agencyId, executionId) : [];
    const produced = {
      executionId,
      models: [...new Map(calls.filter((c) => !c.error).map((c) => [`${c.task}:${c.actualModel ?? c.requestedModel}`, { task: c.task, model: c.actualModel ?? c.requestedModel, provider: c.provider }])).values()],
    };
    return {
      produced,
      id: version.id, artifactId: version.artifactId, version: version.version, kind: version.kind,
      causeKind: version.causeKind, causeTurnId: version.causeTurnId, createdAt: version.createdAt.toISOString(),
      blocks: version.blocks,
      renderedBlocks: renderBlocks(version.blocks as Block[], (id) => metrics[id]),
      metrics: Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [id, withDisplay(metric)])),
      scopes: evidence.scopes ?? [], checks: version.checks,
    };
  });

  done();
}
