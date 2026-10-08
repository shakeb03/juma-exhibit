import { defineConfig } from "vitest/config";

// Integration tests talk to the real Neon database and run only via `pnpm test:integration`.
export default defineConfig({
  test: { exclude: ["**/node_modules/**", "**/*.integration.test.ts"] },
});
