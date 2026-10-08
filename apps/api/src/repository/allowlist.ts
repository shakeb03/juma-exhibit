/**
 * Which repository paths the in-app code browser may show: application code, shared packages, migrations,
 * fixtures, and safe documentation. Secrets, environment files, lockfiles, build output, and binaries are never served.
 */

const ALLOWED_PREFIXES = ["apps/", "packages/", "fixtures/", "docs/"];
const ALLOWED_ROOT_FILES = new Set(["README.md", "package.json", "pnpm-workspace.yaml", "tsconfig.base.json", "eslint.config.mjs", "railway.json", ".nvmrc"]);
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|md|sql|css|yaml|yml|csv|txt|toml|html)$/i;

const DENIED = [
  /(^|\/)\.env(\.|$)/i, // environment files, including .env.local and .env.production
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.claude\//,
  /pnpm-lock\.yaml$/, // large and not informative
  /\.(pem|key|crt|p12|pfx)$/i,
  /(^|\/)(secrets?|credentials?)(\.|\/)/i,
  /\.tsbuildinfo$/,
];

export const MAX_FILE_BYTES = 200 * 1024;

/** Reject traversal and odd characters before anything else looks at a path. */
export function isSafePath(path: string): boolean {
  if (path.length === 0 || path.length > 300) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((part) => part !== ".." && part !== "." && part !== "");
}

export function isAllowedPath(path: string): boolean {
  if (!isSafePath(path)) return false;
  if (DENIED.some((pattern) => pattern.test(path))) return false;
  if (ALLOWED_ROOT_FILES.has(path)) return true;
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) && TEXT_EXTENSIONS.test(path);
}

/** A ref is a commit SHA or a branch name made of safe characters. Anything else is refused. */
export function isSafeRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref) || /^[A-Za-z0-9._-]{1,60}$/.test(ref);
}

export const isCommitSha = (ref: string) => /^[0-9a-f]{7,40}$/i.test(ref);

export function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ({ ts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", json: "json", md: "markdown", sql: "sql", css: "css", yaml: "yaml", yml: "yaml", html: "html" } as Record<string, string>)[ext] ?? "text";
}
