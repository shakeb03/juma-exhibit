import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1),
  BACKEND_PROXY_SECRET: z.string().min(16, "BACKEND_PROXY_SECRET must be at least 16 characters"),
  APP_ORIGIN: z.string().url(),
  OPENROUTER_API_KEY: z.string().min(1),
  GIT_COMMIT: z.string().optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
});

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  directDatabaseUrl: string;
  proxySecret: string;
  appOrigin: string;
  openRouterApiKey: string;
  commit: string | null;
}

/** Validate required configuration at startup and fail with a readable list of problems. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const value = parsed.data;
  return {
    port: value.PORT,
    host: value.HOST,
    databaseUrl: value.DATABASE_URL,
    directDatabaseUrl: value.DIRECT_DATABASE_URL,
    proxySecret: value.BACKEND_PROXY_SECRET,
    appOrigin: value.APP_ORIGIN,
    openRouterApiKey: value.OPENROUTER_API_KEY,
    commit: value.GIT_COMMIT ?? value.RAILWAY_GIT_COMMIT_SHA ?? null,
  };
}
