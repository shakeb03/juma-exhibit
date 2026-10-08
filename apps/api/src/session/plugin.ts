import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createSessionRequestSchema, updateSharingRequestSchema, type SessionResponse } from "@exhibit/contracts";
import {
  countActiveAgencies, createAgency, createSession, deleteAgency, findSession, listClients, listSources, setClientSharing,
  withTransaction, type Database, type SessionRecord,
} from "@exhibit/database";
import type { Config } from "../config.js";
import { seedAgency } from "../seed/seed.js";
import { conversationRoutes } from "../conversations/plugin.js";
import { RateLimiter } from "./rateLimit.js";
import { csrfTokenFor, hashToken, newSessionToken, safeEqual } from "./tokens.js";

export const SESSION_COOKIE = "exhibit_session";

declare module "fastify" {
  interface FastifyRequest {
    /** Set on routes behind authentication. Agency access always comes from here, never from a request. */
    session: (SessionRecord & { csrfToken: string }) | null;
  }
}

export interface SessionOptions {
  db: Database;
  config: Pick<
    Config,
    "proxySecret" | "appOrigin" | "commit" | "sessionTtlMs" | "agencyTokenBudget" | "sessionCreatesPerHour" | "maxActiveAgencies" | "demoEntryCode" | "fixturesDir"
  >;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function error(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}

export async function sessionPlugin(app: FastifyInstance, options: SessionOptions) {
  const { db, config } = options;
  const limiter = new RateLimiter(config.sessionCreatesPerHour, 60 * 60 * 1000);
  const secureCookie = config.appOrigin.startsWith("https://");

  await app.register(cookie);
  app.decorateRequest("session", null);

  /** Resolve the cookie to a live session. Returns null for anything missing, expired, or unknown. */
  async function resolve(request: FastifyRequest) {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const record = await findSession(db, tokenHash);
    return record ? { ...record, csrfToken: csrfTokenFor(config.proxySecret, tokenHash) } : null;
  }

  const toResponse = (s: NonNullable<FastifyRequest["session"]>): SessionResponse => ({
    agencyId: s.agencyId,
    expiresAt: s.expiresAt.toISOString(),
    csrfToken: s.csrfToken,
  });

  // Creating a session needs the proxy secret (enforced globally) but not an existing session.
  app.post("/v1/session", async (request, reply) => {
    const body = createSessionRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return error(reply, request, 400, "bad_request", "Invalid request body.");

    const existing = await resolve(request);
    if (existing) return toResponse(existing);

    if (config.demoEntryCode && !safeEqual(body.data.code, config.demoEntryCode)) {
      return error(reply, request, 403, "entry_code_required", "A valid entry code is required.");
    }

    // The proxy forwards the visitor's address; it is trusted only because the proxy secret passed.
    const clientIp = (request.headers["x-client-ip"] as string | undefined) ?? request.ip;
    if (!limiter.allow(clientIp)) {
      return error(reply, request, 429, "rate_limited", "Too many demo sessions from this address. Try again later.");
    }
    if ((await countActiveAgencies(db)) >= config.maxActiveAgencies) {
      return error(reply, request, 503, "capacity_reached", "The demo is at capacity. Please try again shortly.");
    }

    const token = newSessionToken();
    const tokenHash = hashToken(token);
    const created = await withTransaction(db, async (client) => {
      const agency = await createAgency(client, { ttlMs: config.sessionTtlMs, tokenBudget: config.agencyTokenBudget });
      await seedAgency(client, agency.id, config.fixturesDir);
      const sessionId = await createSession(client, { agencyId: agency.id, tokenHash, expiresAt: agency.expiresAt });
      return { agency, sessionId };
    });

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });
    return reply.status(201).send({
      agencyId: created.agency.id,
      expiresAt: created.agency.expiresAt.toISOString(),
      csrfToken: csrfTokenFor(config.proxySecret, tokenHash),
    } satisfies SessionResponse);
  });

  // Everything below requires a live session; writes also require the CSRF token.
  await app.register(async (protectedApp) => {
    protectedApp.addHook("onRequest", async (request, reply) => {
      const session = await resolve(request);
      if (!session) return error(reply, request, 401, "session_required", "Your demo session has expired or does not exist.");
      if (!SAFE_METHODS.has(request.method)) {
        const header = request.headers["x-csrf-token"];
        if (!safeEqual(Array.isArray(header) ? header[0] : header, session.csrfToken)) {
          return error(reply, request, 403, "bad_csrf", "Missing or invalid CSRF token.");
        }
      }
      request.session = session;
    });

    await protectedApp.register(conversationRoutes, { db, config });

    protectedApp.get("/v1/session", async (request) => toResponse(request.session!));

    protectedApp.delete("/v1/session", async (request, reply) => {
      await deleteAgency(db, request.session!.agencyId);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.status(204).send();
    });

    protectedApp.get("/v1/clients", async (request) => ({ clients: await listClients(db, request.session!.agencyId) }));
    // Fictional consent controls. A change bumps the permission version so older intelligence results go stale.
    protectedApp.patch<{ Params: { clientId: string } }>("/v1/clients/:clientId/sharing", async (request, reply) => {
      const params = z.object({ clientId: z.string().uuid() }).safeParse(request.params);
      const body = updateSharingRequestSchema.safeParse(request.body);
      if (!params.success || !body.success) return error(reply, request, 400, "bad_request", "Invalid client or sharing settings.");
      const updated = await setClientSharing(db, request.session!.agencyId, params.data.clientId, body.data);
      if (!updated) return error(reply, request, 404, "not_found", "Client not found.");
      return {
        id: updated.id,
        sharing: { performancePatterns: updated.sharePerformance, creativeAssets: updated.shareCreative },
        permissionVersion: updated.permissionVersion,
      };
    });

    protectedApp.get("/v1/sources", async (request) => ({ sources: await listSources(db, request.session!.agencyId) }));
  });
}
