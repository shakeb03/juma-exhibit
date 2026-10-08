import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Locate the fixtures directory from the repo root (Railway), apps/api (local), or FIXTURES_DIR. */
export function resolveFixturesDir(override?: string): string {
  const candidates = [override, resolve(process.cwd(), "fixtures"), resolve(process.cwd(), "../../fixtures")].filter(
    (dir): dir is string => Boolean(dir),
  );
  const found = candidates.find((dir) => existsSync(resolve(dir, "manifest.json")));
  if (!found) throw new Error(`Fixtures directory not found. Looked in:\n${candidates.join("\n")}`);
  return found;
}
