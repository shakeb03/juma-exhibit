import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { EDITABLE_FIELDS, blockSchema, createCommentRequestSchema, manualEditRequestSchema, type Block } from "@exhibit/contracts";
import {
  TooManyCommentsError, acceptComment, appendVersion, createComment, getArtifact, getVersion, listComments, rejectComment,
  retryComment, withTransaction, type CommentRecord, type Database,
} from "@exhibit/database";
import { renderBlocks } from "../agent/render.js";
import type { RegistryMetric } from "../agent/registry.js";
import type { Config } from "../config.js";
import { fail } from "../conversations/plugin.js";

const idParam = z.object({ id: z.string().uuid() });

export function commentRoutes(app: FastifyInstance, options: { db: Database; config: Pick<Config, "commit"> }, done: (err?: Error) => void) {
  const { db, config } = options;
  const session = (request: FastifyRequest) => request.session!;

  const render = async (agencyId: string, comments: CommentRecord[]) => {
    const versions = new Map<string, Awaited<ReturnType<typeof getVersion>>>();
    const out = [];
    for (const comment of comments) {
      if (!versions.has(comment.versionId)) versions.set(comment.versionId, await getVersion(db, agencyId, comment.versionId));
      const version = versions.get(comment.versionId);
      const metrics = (version?.evidence as { metrics?: Record<string, RegistryMetric> } | undefined)?.metrics ?? {};
      const lookup = (id: string) => metrics[id];
      const before = version?.blocks.find((b) => b.id === comment.blockId);
      out.push({
        id: comment.id, versionId: comment.versionId, versionNumber: version?.version ?? null, blockId: comment.blockId,
        selection: comment.selection, body: comment.body, status: comment.status, createdAt: comment.createdAt.toISOString(),
        executionId: comment.executionId, resultingVersionId: comment.resultingVersionId,
        error: comment.proposal?.error ?? null,
        proposal: comment.proposal?.block
          ? {
              summary: comment.proposal.summary ?? "",
              claims: comment.proposal.claims ?? null,
              before: before ? renderBlocks([before], lookup)[0] : null,
              after: renderBlocks([comment.proposal.block], lookup)[0],
            }
          : null,
      });
    }
    return out;
  };

  app.get<{ Params: { id: string } }>("/v1/artifacts/:id/comments", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid artifact ID.");
    const { agencyId } = session(request);
    if (!(await getArtifact(db, agencyId, params.data.id))) return fail(reply, request, 404, "not_found", "Artifact not found.");
    return { comments: await render(agencyId, await listComments(db, agencyId, params.data.id)) };
  });

  app.post<{ Params: { id: string } }>("/v1/artifact-versions/:id/comments", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = createCommentRequestSchema.safeParse(request.body);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid version ID.");
    if (!body.success) return fail(reply, request, 400, "bad_request", body.error.issues[0]?.message ?? "Invalid comment.");
    const { agencyId, sessionId } = session(request);
    const version = await getVersion(db, agencyId, params.data.id);
    if (!version) return fail(reply, request, 404, "not_found", "Version not found.");
    const target = version.blocks.find((b) => b.id === body.data.blockId);
    if (!target) return fail(reply, request, 404, "not_found", "That block is not in this version.");
    if (target.type === "metric_table") return fail(reply, request, 400, "not_commentable", "Metric tables cannot take comments yet. You can edit the caption directly.");
    try {
      const created = await createComment(db, { agencyId, sessionId, versionId: version.id, blockId: target.id, body: body.data.body, selection: body.data.selection, backendCommit: config.commit });
      if ("error" in created) return fail(reply, request, 404, "not_found", "That block is not in this version.");
      return reply.status(202).send((await render(agencyId, [created.comment]))[0]);
    } catch (error) {
      if (error instanceof TooManyCommentsError) return fail(reply, request, 409, "too_many_comments", "This artifact has too many comments waiting. Accept or reject some first.");
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/comments/:id/accept", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid comment ID.");
    const outcome = await acceptComment(db, session(request).agencyId, params.data.id);
    if (outcome.ok) return { versionId: outcome.versionId, version: outcome.version };
    if (outcome.reason === "not_found") return fail(reply, request, 404, "not_found", "Comment not found.");
    if (outcome.reason === "stale") return fail(reply, request, 409, "comment_stale", "That block changed after the comment was written, so this proposal no longer applies. Ask for a new one.");
    if (outcome.reason === "not_proposed") return fail(reply, request, 409, "not_proposed", "There is no proposal to accept.");
    return fail(reply, request, 409, "proposal_rejected", outcome.message ?? "The proposal could not be applied.");
  });

  app.post<{ Params: { id: string } }>("/v1/comments/:id/reject", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid comment ID.");
    const outcome = await rejectComment(db, session(request).agencyId, params.data.id);
    if (outcome === null) return fail(reply, request, 404, "not_found", "Comment not found.");
    if (outcome === "not_allowed") return fail(reply, request, 409, "not_rejectable", "This comment has no proposal to dismiss.");
    return (await render(session(request).agencyId, [outcome]))[0];
  });

  app.post<{ Params: { id: string } }>("/v1/comments/:id/retry", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid comment ID.");
    const outcome = await retryComment(db, session(request).agencyId, params.data.id, config.commit);
    if (outcome === null) return fail(reply, request, 404, "not_found", "Comment not found.");
    if (outcome === "not_allowed") return fail(reply, request, 409, "not_retryable", "This comment is already being worked on or is settled.");
    return reply.status(202).send((await render(session(request).agencyId, [outcome]))[0]);
  });

  // A person edits one block directly. Numbers are theirs to change and are not rechecked.
  app.post<{ Params: { id: string } }>("/v1/artifacts/:id/edits", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    const body = manualEditRequestSchema.safeParse(request.body);
    if (!params.success) return fail(reply, request, 400, "bad_request", "Invalid artifact ID.");
    if (!body.success) return fail(reply, request, 400, "bad_request", body.error.issues[0]?.message ?? "Invalid edit.");
    const { agencyId } = session(request);
    const artifact = await getArtifact(db, agencyId, params.data.id);
    if (!artifact) return fail(reply, request, 404, "not_found", "Artifact not found.");

    const result = await withTransaction(db, (tx) =>
      appendVersion(tx, {
        agencyId, artifactId: artifact.id, baseVersionId: body.data.baseVersionId, cause: { kind: "manual" },
        build: (base) => {
          const target = base.blocks.find((b) => b.id === body.data.blockId);
          if (!target) return { error: "That block is not in this version." };
          const allowed = EDITABLE_FIELDS[target.type];
          const unknown = Object.keys(body.data.fields).filter((f) => !allowed.includes(f));
          if (unknown.length) return { error: `A ${target.type.replace("_", " ")} has no editable field "${unknown[0]}".` };
          const stored = target as Record<string, unknown>;
          // Fields left as they were keep their stored text, including metric placeholders.
          const changed = Object.entries(body.data.fields).filter(([field, value]) => value !== stored[field]);
          if (changed.length === 0) return { error: "Nothing changed." };
          const merged = blockSchema.safeParse({ ...target, ...Object.fromEntries(changed) });
          if (!merged.success) return { error: merged.error.issues.map((i) => i.message).join("; ") };
          const blocks: Block[] = base.blocks.map((b) => (b.id === target.id ? merged.data : b));
          return { blocks, edit: { blockId: target.id, changes: changed.map(([field, after]) => ({ field, before: stored[field], after })) } };
        },
      }),
    );
    if (result.ok) return { versionId: result.versionId, version: result.version };
    if (result.reason === "moved_on") return fail(reply, request, 409, "version_moved_on", "This artifact has a newer version. Open the latest and edit there.");
    if (result.reason === "not_found") return fail(reply, request, 404, "not_found", "Version not found.");
    return fail(reply, request, 400, "invalid_edit", result.message ?? "That edit could not be saved.");
  });

  done();
}
