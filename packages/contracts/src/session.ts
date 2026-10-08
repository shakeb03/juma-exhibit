import { z } from "zod";

export const createSessionRequestSchema = z.object({
  /** Only required when the server has an entry code configured (off by default). */
  code: z.string().optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionResponseSchema = z.object({
  agencyId: z.string().uuid(),
  expiresAt: z.string(),
  /** Send as x-csrf-token on every write. Derived from the session, never stored in the browser cookie. */
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const clientSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  sharing: z.object({
    performancePatterns: z.boolean(),
    creativeAssets: z.boolean(),
  }),
  permissionVersion: z.number().int(),
  counts: z.object({
    sources: z.number().int(),
    campaigns: z.number().int(),
    creativeReferences: z.number().int(),
  }),
});
export type ClientSummary = z.infer<typeof clientSummarySchema>;

export const sourceKindSchema = z.enum([
  "brand_context",
  "brief",
  "campaign_data",
  "creative_references",
  "creative_image",
  "previous_work",
  "new_client_brief",
  "reference",
  "attachment",
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceSummarySchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
  kind: sourceKindSchema,
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(["pending", "ready", "failed"]),
});
export type SourceSummary = z.infer<typeof sourceSummarySchema>;

export const updateSharingRequestSchema = z.object({
  performancePatterns: z.boolean(),
  creativeAssets: z.boolean(),
});
export type UpdateSharingRequest = z.infer<typeof updateSharingRequestSchema>;
