import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const config = { proxySecret: "test-secret-0123456789", commit: "abc123" };

function appWith(pingDatabase: () => Promise<void> = async () => {}) {
  return buildApp(config, { pingDatabase, logger: false });
}

describe("system routes", () => {
  it("answers health without credentials", async () => {
    const res = await appWith().inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("reports ready when the database responds", async () => {
    const res = await appWith().inject({ method: "GET", url: "/v1/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready", database: "ok" });
  });

  it("reports 503 with an error body when the database is down", async () => {
    const app = appWith(async () => {
      throw new Error("down");
    });
    const res = await app.inject({ method: "GET", url: "/v1/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("database_unavailable");
    expect(res.json().error.requestId).toBeTruthy();
  });
});

describe("proxy secret", () => {
  it("rejects other routes without the secret", async () => {
    const res = await appWith().inject({ method: "GET", url: "/v1/version" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
  });

  it("rejects a wrong secret", async () => {
    const res = await appWith().inject({
      method: "GET",
      url: "/v1/version",
      headers: { "x-proxy-secret": "wrong-secret-0123456789" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts the right secret and returns version info", async () => {
    const res = await appWith().inject({
      method: "GET",
      url: "/v1/version",
      headers: { "x-proxy-secret": config.proxySecret },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiVersion: "0.0.0", commit: "abc123" });
  });
});
