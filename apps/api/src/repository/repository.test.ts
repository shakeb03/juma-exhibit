import { describe, expect, it } from "vitest";
import { isAllowedPath, isSafePath, isSafeRef } from "./allowlist.js";
import { RepositoryError, RepositoryReader } from "./github.js";

describe("path allowlist", () => {
  it.each([
    "apps/api/src/app.ts", "apps/web/components/workspace/blocks.tsx", "packages/database/migrations/001_foundation.sql",
    "fixtures/manifest.json", "docs/TRD.md", "README.md", "railway.json",
  ])("serves %s", (path) => expect(isAllowedPath(path)).toBe(true));

  it.each([
    ".env", "apps/api/.env", "apps/web/.env.local", "apps/api/.env.production", "pnpm-lock.yaml", "node_modules/x/index.js",
    "apps/web/.next/server/app.js", "apps/api/dist/index.js", ".git/config", ".claude/launch.json", "apps/api/secrets.json",
    "apps/web/public/logo.png", "id_rsa.pem", "random-root-file.ts", "other/dir/file.ts",
  ])("refuses %s", (path) => expect(isAllowedPath(path)).toBe(false));

  it("rejects traversal and malformed paths before anything else", () => {
    for (const path of ["../etc/passwd", "apps/../../secret.ts", "/etc/passwd", "apps\\api\\app.ts", "apps//api/app.ts", "", "apps/api/\0.ts", "./apps/api/app.ts"]) {
      expect(isSafePath(path), JSON.stringify(path)).toBe(false);
      expect(isAllowedPath(path)).toBe(false);
    }
  });

  it("accepts commit SHAs and plain branch names, and refuses anything that could alter the request", () => {
    for (const ref of ["main", "a1b2c3d", "a".repeat(40), "release-1.2"]) expect(isSafeRef(ref)).toBe(true);
    for (const ref of ["../main", "main?x=1", "a/b", "main#x", "", "x".repeat(80), "main\n"]) expect(isSafeRef(ref)).toBe(false);
  });
});

const config = { owner: "someone", name: "exhibit-a", token: "ghp_secret_token_value", defaultBranch: "main", backendCommit: "a".repeat(40) };

function reader(handler: (url: string, init: RequestInit) => Response | Promise<Response>, overrides: Partial<typeof config> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return handler(url, init);
  }) as unknown as typeof fetch;
  let time = 0;
  return { calls, advance: (ms: number) => { time += ms; }, reader: new RepositoryReader({ ...config, ...overrides }, fetchImpl, () => time) };
}

const treeResponse = (nodes: object[]) => new Response(JSON.stringify({ tree: nodes }), { status: 200 });
const NODES = [
  { path: "apps/api/src/app.ts", type: "blob", size: 120 },
  { path: "apps/api/.env", type: "blob", size: 40 },
  { path: "pnpm-lock.yaml", type: "blob", size: 9999 },
  { path: "apps/api/src", type: "tree" },
  { path: "apps/web/public/logo.png", type: "blob", size: 500 },
  { path: "apps/api/src/huge.ts", type: "blob", size: 500 * 1024 },
];

describe("RepositoryReader", () => {
  it("lists only allowlisted files and pins to the deployed commit by default", async () => {
    const { reader: r, calls } = reader(() => treeResponse(NODES));
    const result = await r.tree();
    expect(result.entries.map((e) => e.path)).toEqual(["apps/api/src/app.ts", "apps/api/src/huge.ts"]);
    expect(result.pinned).toBe(true);
    expect(result.ref).toBe(config.backendCommit);
    expect(calls[0]!.url).toContain(`/git/trees/${config.backendCommit}?recursive=1`);
    // The token goes to GitHub from the server and is never part of what is returned.
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${config.token}`);
    expect(JSON.stringify(result)).not.toContain("ghp_secret");
  });

  it("falls back to the default branch, labelled as not pinned, when no commit is known", async () => {
    const { reader: r } = reader(() => treeResponse(NODES), { backendCommit: null as never });
    const result = await r.tree();
    expect(result).toMatchObject({ ref: "main", pinned: false });
  });

  it("serves a file only if it is in the allowlisted tree for that exact ref", async () => {
    const { reader: r } = reader((url) => (url.includes("/git/trees/") ? treeResponse(NODES) : new Response("export const x = 1;\n", { status: 200 })));
    const file = await r.file("apps/api/src/app.ts");
    expect(file).toMatchObject({ path: "apps/api/src/app.ts", language: "typescript", content: "export const x = 1;\n", pinned: true });
    for (const path of ["apps/api/.env", "../secret", "pnpm-lock.yaml", "apps/api/src/missing.ts"]) {
      await expect(r.file(path)).rejects.toBeInstanceOf(RepositoryError);
    }
  });

  it("refuses oversized and non-text files", async () => {
    const { reader: r } = reader((url) => (url.includes("/git/trees/") ? treeResponse([{ path: "apps/api/src/binary.ts", type: "blob", size: 10 }, ...NODES]) : new Response("a\0b", { status: 200 })));
    await expect(r.file("apps/api/src/huge.ts")).rejects.toMatchObject({ code: "too_large" });
    await expect(r.file("apps/api/src/binary.ts")).rejects.toMatchObject({ code: "not_text" });
  });

  it("caches a pinned commit forever but a branch only briefly", async () => {
    const pinned = reader(() => treeResponse(NODES));
    await pinned.reader.tree(); await pinned.reader.tree();
    pinned.advance(24 * 3600_000);
    await pinned.reader.tree();
    expect(pinned.calls).toHaveLength(1);

    const branch = reader(() => treeResponse(NODES), { backendCommit: null as never });
    await branch.reader.tree(); await branch.reader.tree();
    expect(branch.calls).toHaveLength(1);
    branch.advance(61_000);
    await branch.reader.tree();
    expect(branch.calls).toHaveLength(2);
  });

  it("reports clear states when unconfigured, unreachable, or rate limited", async () => {
    const none = new RepositoryReader({ ...config, owner: null, name: null });
    expect(none.meta().configured).toBe(false);
    await expect(none.tree()).rejects.toMatchObject({ code: "not_configured" });

    const down = reader(() => { throw new Error("ECONNREFUSED"); });
    await expect(down.reader.tree()).rejects.toMatchObject({ code: "unavailable", message: "GitHub could not be reached." });
    const limited = reader(() => new Response("", { status: 403 }));
    await expect(limited.reader.tree()).rejects.toMatchObject({ code: "unavailable" });
    const missing = reader(() => new Response("", { status: 404 }));
    await expect(missing.reader.tree("a1b2c3d")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses an unsafe ref before contacting GitHub", async () => {
    const { reader: r, calls } = reader(() => treeResponse(NODES));
    await expect(r.tree("../../etc")).rejects.toMatchObject({ code: "bad_request" });
    expect(calls).toHaveLength(0);
  });
});
