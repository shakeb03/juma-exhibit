import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Database } from "@exhibit/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { SESSION_COOKIE } from "./plugin.js";

// Runs against the real Neon database configured in .env. Every agency it creates is deleted afterwards.
const config = loadConfig();
let db: Database;
let app: FastifyInstance;
const createdAgencies: string[] = [];

const secret = { "x-proxy-secret": config.proxySecret };

async function enter(extraHeaders: Record<string, string> = {}) {
  const res = await app.inject({ method: "POST", url: "/v1/session", headers: { ...secret, ...extraHeaders }, payload: {} });
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (res.statusCode === 201) createdAgencies.push(res.json().agencyId);
  return { res, cookie };
}

beforeAll(() => {
  db = createPool({ connectionString: config.databaseUrl, max: 3 });
  app = buildApp(config, { pingDatabase: async () => {}, db, sessionConfig: config, logger: false });
});

afterAll(async () => {
  if (createdAgencies.length) await db.query("delete from agencies where id = any($1)", [createdAgencies]);
  await db.end();
});

describe("demo session entry and seeding", () => {
  it("opens without setup: creates an isolated agency with a secure cookie", async () => {
    const { res, cookie } = await enter({ "x-client-ip": "198.51.100.1" });
    expect(res.statusCode).toBe(201);
    expect(res.json().csrfToken).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.path).toBe("/");
    // Only a hash is stored, never the token itself.
    const stored = await db.query("select token_hash from sessions where agency_id = $1", [res.json().agencyId]);
    expect(stored.rows[0].token_hash).not.toBe(cookie?.value);
  });

  it("seeds three clients with the planned sharing flags", async () => {
    const { res, cookie } = await enter({ "x-client-ip": "198.51.100.2" });
    const headers = { cookie: `${SESSION_COOKIE}=${cookie!.value}` };
    const clients = (await app.inject({ method: "GET", url: "/v1/clients", headers: { ...secret, ...headers } })).json().clients;
    expect(res.statusCode).toBe(201);
    const bySlug = Object.fromEntries(clients.map((c: { slug: string }) => [c.slug, c]));
    expect(Object.keys(bySlug).sort()).toEqual(["marlowe-finch", "ridgeline-outfitters", "velvet-static"]);
    expect(bySlug["ridgeline-outfitters"].sharing).toEqual({ performancePatterns: true, creativeAssets: true });
    expect(bySlug["marlowe-finch"].sharing).toEqual({ performancePatterns: true, creativeAssets: true });
    expect(bySlug["velvet-static"].sharing).toEqual({ performancePatterns: false, creativeAssets: false });
    expect(bySlug["ridgeline-outfitters"].counts).toEqual({ sources: 8, campaigns: 7, creativeReferences: 6 });
    expect(bySlug["velvet-static"].counts).toEqual({ sources: 4, campaigns: 3, creativeReferences: 3 });
  });

  it("loads brand context, sources, campaign rows with missing-vs-zero preserved, and a starting canvas", async () => {
    const { res, cookie } = await enter({ "x-client-ip": "198.51.100.3" });
    const agencyId = res.json().agencyId;
    const brand = await db.query("select brand_voice, constraints, standing_instructions from clients where agency_id = $1 and slug = 'marlowe-finch'", [agencyId]);
    expect(brand.rows[0].constraints).toMatch(/discount/);
    expect(brand.rows[0].standing_instructions).toMatch(/conversions/);

    const sources = (await app.inject({ method: "GET", url: "/v1/sources", headers: { ...secret, cookie: `${SESSION_COOKIE}=${cookie!.value}` } })).json().sources;
    expect(sources).toHaveLength(19);
    expect(sources.filter((s: { kind: string }) => s.kind === "attachment")).toHaveLength(4);
    expect(sources.filter((s: { kind: string }) => s.kind === "new_client_brief")).toHaveLength(1);
    // Only metadata is listed; no bytes.
    expect(JSON.stringify(sources)).not.toMatch(/"data"/);

    const canvas = await db.query("select revision, nodes, edges from canvases where agency_id = $1", [agencyId]);
    expect(canvas.rows[0].revision).toBe(1);
    expect(canvas.rows[0].nodes).toHaveLength(5);
    expect(canvas.rows[0].edges).toEqual([]);
  });

  it("shares fixture bytes between visitors without duplicating them", async () => {
    await enter({ "x-client-ip": "198.51.100.4" });
    const before = await db.query("select count(*)::int as n from file_blobs where fixture_key is not null");
    await enter({ "x-client-ip": "198.51.100.5" });
    const after = await db.query("select count(*)::int as n from file_blobs where fixture_key is not null");
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(after.rows[0].n).toBe(19);
  });

  it("isolates agencies: one visitor cannot see another's records", async () => {
    const a = await enter({ "x-client-ip": "198.51.100.6" });
    const b = await enter({ "x-client-ip": "198.51.100.7" });
    const listA = (await app.inject({ method: "GET", url: "/v1/clients", headers: { ...secret, cookie: `${SESSION_COOKIE}=${a.cookie!.value}` } })).json().clients;
    const listB = (await app.inject({ method: "GET", url: "/v1/clients", headers: { ...secret, cookie: `${SESSION_COOKIE}=${b.cookie!.value}` } })).json().clients;
    const idsA = new Set(listA.map((c: { id: string }) => c.id));
    expect(listB.some((c: { id: string }) => idsA.has(c.id))).toBe(false);
  });

  it("reuses the existing session instead of creating another agency", async () => {
    const first = await enter({ "x-client-ip": "198.51.100.8" });
    const again = await app.inject({
      method: "POST", url: "/v1/session", payload: {},
      headers: { ...secret, cookie: `${SESSION_COOKIE}=${first.cookie!.value}`, "x-client-ip": "198.51.100.8" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().agencyId).toBe(first.res.json().agencyId);
  });

  it("requires a session, a CSRF token for writes, and ends the session by deleting all data", async () => {
    const none = await app.inject({ method: "GET", url: "/v1/clients", headers: secret });
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe("session_required");

    const { res, cookie } = await enter({ "x-client-ip": "198.51.100.9" });
    const headers = { ...secret, cookie: `${SESSION_COOKIE}=${cookie!.value}` };
    expect((await app.inject({ method: "GET", url: "/v1/session", headers })).statusCode).toBe(200);

    const noCsrf = await app.inject({ method: "DELETE", url: "/v1/session", headers });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe("bad_csrf");

    const ok = await app.inject({ method: "DELETE", url: "/v1/session", headers: { ...headers, "x-csrf-token": res.json().csrfToken } });
    expect(ok.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/session", headers })).statusCode).toBe(401);
    const left = await db.query("select (select count(*) from clients where agency_id = $1)::int as clients, (select count(*) from campaign_rows where agency_id = $1)::int as rows", [res.json().agencyId]);
    expect(left.rows[0]).toEqual({ clients: 0, rows: 0 });
  });

  it("rejects an expired session", async () => {
    const { res, cookie } = await enter({ "x-client-ip": "198.51.100.10" });
    await db.query("update sessions set expires_at = now() - interval '1 minute' where agency_id = $1", [res.json().agencyId]);
    const check = await app.inject({ method: "GET", url: "/v1/session", headers: { ...secret, cookie: `${SESSION_COOKIE}=${cookie!.value}` } });
    expect(check.statusCode).toBe(401);
  });

  it("rate-limits session creation per address", async () => {
    const limited = buildApp(
      { ...config },
      { pingDatabase: async () => {}, db, sessionConfig: { ...config, sessionCreatesPerHour: 1 }, logger: false },
    );
    const ip = { ...secret, "x-client-ip": "198.51.100.11" };
    const first = await limited.inject({ method: "POST", url: "/v1/session", headers: ip, payload: {} });
    if (first.statusCode === 201) createdAgencies.push(first.json().agencyId);
    const second = await limited.inject({ method: "POST", url: "/v1/session", headers: ip, payload: {} });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("rate_limited");
  });

  it("enforces an entry code only when one is configured", async () => {
    const guarded = buildApp(
      { ...config },
      { pingDatabase: async () => {}, db, sessionConfig: { ...config, demoEntryCode: "letmein-123" }, logger: false },
    );
    const headers = { ...secret, "x-client-ip": "198.51.100.12" };
    const wrong = await guarded.inject({ method: "POST", url: "/v1/session", headers, payload: { code: "nope" } });
    expect(wrong.statusCode).toBe(403);
    const right = await guarded.inject({ method: "POST", url: "/v1/session", headers, payload: { code: "letmein-123" } });
    if (right.statusCode === 201) createdAgencies.push(right.json().agencyId);
    expect(right.statusCode).toBe(201);
  });
});
