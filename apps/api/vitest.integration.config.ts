import { defineConfig } from "vitest/config";

// The tests build their own app, so they use a test-only proxy secret instead of the real one.
// Variables already set are not overridden by loadEnvFile, so this must come first.
process.env.BACKEND_PROXY_SECRET = "integration-test-secret-0123456789";
// Loads Neon and OpenRouter settings from apps/api/.env (Node 20.12+).
process.loadEnvFile(".env");

export default defineConfig({
  test: { include: ["**/*.integration.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
