import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readyResponseSchema = z.object({
  status: z.literal("ready"),
  database: z.literal("ok"),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export const versionResponseSchema = z.object({
  apiVersion: z.string(),
  commit: z.string().nullable(),
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;
