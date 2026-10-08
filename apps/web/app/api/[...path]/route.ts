// Thin same-origin proxy to the Railway API. No business logic, no database access.
// Only mapped /v1 routes are forwarded; the upstream URL is fixed by configuration.

const ALLOWED_PATH = /^[a-z0-9-]+(\/[A-Za-z0-9._-]+)*$/;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const FORWARDED_REQUEST_HEADERS = ["content-type", "cookie", "accept", "idempotency-key", "x-csrf-token"];

function config() {
  const backendUrl = process.env.BACKEND_URL;
  const secret = process.env.BACKEND_PROXY_SECRET;
  if (!backendUrl || !secret) throw new Error("BACKEND_URL and BACKEND_PROXY_SECRET must be set.");
  return { backendUrl: backendUrl.replace(/\/$/, ""), secret, appOrigin: process.env.APP_ORIGIN };
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, requestId: crypto.randomUUID() } }, { status });
}

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (!ALLOWED_PATH.test(joined)) return errorResponse(400, "bad_path", "Invalid path.");

  const { backendUrl, secret, appOrigin } = config();

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (!appOrigin || origin !== appOrigin) {
      return errorResponse(403, "bad_origin", "Cross-origin writes are not allowed.");
    }
  }

  const url = new URL(request.url);
  const upstream = new URL(`${backendUrl}/v1/${joined}`);
  upstream.search = url.search;

  const headers = new Headers({ "x-proxy-secret": secret });
  // Pass the visitor's address so the API can rate-limit per visitor; it trusts this only after the secret check.
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) headers.set("x-client-ip", forwardedFor);
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: SAFE_METHODS.has(request.method) ? undefined : await request.arrayBuffer(),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  const outgoing = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) outgoing.set("content-type", contentType);
  const disposition = response.headers.get("content-disposition");
  if (disposition) outgoing.set("content-disposition", disposition);
  for (const cookie of response.headers.getSetCookie()) outgoing.append("set-cookie", cookie);
  outgoing.set("cache-control", "no-store");

  return new Response(response.body, { status: response.status, headers: outgoing });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
