import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiError, HealthResponse, ReadyResponse, VersionResponse } from "@exhibit/contracts";
import type { Config } from "./config.js";

export const API_VERSION = "0.0.0";

export interface AppDependencies {
  /** Resolves when the database is reachable, rejects otherwise. */
  pingDatabase: () => Promise<void>;
  /** Disable request logging (tests). Defaults to enabled. */
  logger?: boolean;
}

/** Routes that platform health checks call without the proxy secret. */
const PUBLIC_PATHS = new Set(["/v1/health", "/v1/ready"]);

function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildApp(
  config: Pick<Config, "proxySecret" | "commit">,
  deps: AppDependencies,
): FastifyInstance {
  const app = Fastify({
    logger:
      deps.logger === false
        ? false
        : {
            level: "info",
            // Keep credentials out of logs.
            redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-proxy-secret"]'],
          },
    genReqId: () => crypto.randomUUID(),
  });

  const sendError = (
    reply: { status: (code: number) => { send: (body: ApiError) => unknown } },
    status: number,
    code: string,
    message: string,
    requestId: string,
  ) => reply.status(status).send({ error: { code, message, requestId } });

  // Railway validates the Vercel-to-Railway shared secret on every non-health route.
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (PUBLIC_PATHS.has(path)) return;
    const header = request.headers["x-proxy-secret"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!secretsMatch(provided, config.proxySecret)) {
      return sendError(reply, 401, "unauthorized", "Missing or invalid proxy credentials.", request.id);
    }
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 404, "not_found", "Route not found.", request.id),
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) {
      return sendError(reply, 500, "internal_error", "Something went wrong.", request.id);
    }
    return sendError(reply, status, "bad_request", error instanceof Error ? error.message : "Bad request.", request.id);
  });

  app.get("/v1/health", async (): Promise<HealthResponse> => ({ status: "ok" }));

  app.get("/v1/ready", async (request, reply): Promise<ReadyResponse | unknown> => {
    try {
      await deps.pingDatabase();
    } catch (err) {
      request.log.error({ err }, "database readiness check failed");
      return sendError(reply, 503, "database_unavailable", "Database is not reachable.", request.id);
    }
    return { status: "ready", database: "ok" } satisfies ReadyResponse;
  });

  app.get("/v1/version", async (): Promise<VersionResponse> => ({
    apiVersion: API_VERSION,
    commit: config.commit,
  }));

  return app;
}
