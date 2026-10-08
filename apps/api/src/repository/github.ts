import { MAX_FILE_BYTES, isAllowedPath, isCommitSha, isSafePath, isSafeRef, languageOf } from "./allowlist.js";

export interface RepositoryConfig {
  owner: string | null;
  name: string | null;
  token: string | null;
  defaultBranch: string;
  backendCommit: string | null;
}

export class RepositoryError extends Error {
  constructor(
    public readonly code: "not_configured" | "bad_request" | "not_found" | "unavailable" | "too_large" | "not_text",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export interface TreeEntry {
  path: string;
  size: number;
}

/**
 * Read-only view of one configured GitHub repository, served through the backend so the token stays
 * server-side and only allowlisted text files can be read. A commit SHA is immutable, so it is cached for good;
 * a branch name is cached briefly.
 */
export class RepositoryReader {
  private readonly trees = new Map<string, CacheEntry<TreeEntry[]>>();
  private readonly files = new Map<string, CacheEntry<{ content: string; size: number }>>();

  constructor(
    private readonly config: RepositoryConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.owner && this.config.name);
  }

  meta() {
    return {
      configured: this.configured,
      owner: this.config.owner,
      repository: this.config.name,
      backendCommit: this.config.backendCommit,
      defaultBranch: this.config.defaultBranch,
    };
  }

  /** The ref to browse: the deployed commit when known, otherwise the default branch (not pinned). */
  resolveRef(requested?: string): { ref: string; pinned: boolean } {
    const ref = requested ?? this.config.backendCommit ?? this.config.defaultBranch;
    if (!isSafeRef(ref)) throw new RepositoryError("bad_request", "That version of the code cannot be shown.");
    return { ref, pinned: isCommitSha(ref) };
  }

  private ttl(ref: string): number {
    return isCommitSha(ref) ? Number.POSITIVE_INFINITY : 60_000;
  }

  private async github(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    if (!this.configured) throw new RepositoryError("not_configured", "The repository is not configured for this deployment.");
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.github.com/repos/${this.config.owner}/${this.config.name}${path}`, {
        headers: {
          Accept: accept,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "exhibit-a-code-viewer",
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RepositoryError("unavailable", "GitHub could not be reached.");
    }
    if (response.status === 404) throw new RepositoryError("not_found", "That file or version was not found in the repository.");
    if (response.status === 403 || response.status === 429) throw new RepositoryError("unavailable", "GitHub is limiting requests right now. Try again shortly.");
    if (!response.ok) throw new RepositoryError("unavailable", "GitHub could not be reached.");
    return response;
  }

  async tree(requested?: string): Promise<{ ref: string; pinned: boolean; entries: TreeEntry[] }> {
    const { ref, pinned } = this.resolveRef(requested);
    const cached = this.trees.get(ref);
    if (cached && cached.expires > this.now()) return { ref, pinned, entries: cached.value };

    const response = await this.github(`/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    const body = (await response.json()) as { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };
    const entries = (body.tree ?? [])
      .filter((node) => node.type === "blob" && isAllowedPath(node.path))
      .map((node) => ({ path: node.path, size: node.size ?? 0 }))
      .sort((a, b) => a.path.localeCompare(b.path));
    this.trees.set(ref, { value: entries, expires: this.now() + this.ttl(ref) });
    return { ref, pinned, entries };
  }

  async file(path: string, requested?: string): Promise<{ ref: string; pinned: boolean; path: string; language: string; content: string; size: number }> {
    if (!isSafePath(path) || !isAllowedPath(path)) throw new RepositoryError("bad_request", "That file is not available in the code browser.");
    const { ref, pinned } = this.resolveRef(requested);
    // Only files that appear in the allowlisted tree for this exact ref are served.
    const { entries } = await this.tree(ref);
    const entry = entries.find((e) => e.path === path);
    if (!entry) throw new RepositoryError("not_found", "That file was not found at this version.");
    if (entry.size > MAX_FILE_BYTES) throw new RepositoryError("too_large", `That file is ${Math.round(entry.size / 1024)} KB, over the ${MAX_FILE_BYTES / 1024} KB limit.`);

    const key = `${ref}:${path}`;
    const cached = this.files.get(key);
    if (cached && cached.expires > this.now()) return { ref, pinned, path, language: languageOf(path), ...cached.value };

    const response = await this.github(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json");
    const content = await response.text();
    if (content.includes("\0")) throw new RepositoryError("not_text", "That file is not text.");
    const value = { content, size: entry.size };
    this.files.set(key, { value, expires: this.now() + this.ttl(ref) });
    return { ref, pinned, path, language: languageOf(path), ...value };
  }
}
