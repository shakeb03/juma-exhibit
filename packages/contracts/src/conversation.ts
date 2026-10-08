import { z } from "zod";

export const submitTurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  /** Optional files attached to this request. Attaching never changes who owns a file or its permissions. */
  attachmentSourceIds: z.array(z.string().uuid()).max(5).default([]),
  /** The artifact version the user was looking at, when the request is about it. */
  referencedVersionId: z.string().uuid().optional(),
});
export type SubmitTurnRequest = z.infer<typeof submitTurnRequestSchema>;

export const executionStatusSchema = z.enum(["queued", "running", "waiting_to_retry", "succeeded", "failed", "cancelled"]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const turnSummarySchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  userMessage: z.string(),
  attachmentSourceIds: z.array(z.string().uuid()),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  replyKind: z.enum(["answer", "clarification", "failure"]).nullable(),
  /** Rendered reply with verified values filled in; null until the turn finishes. */
  reply: z.unknown().nullable(),
  executionId: z.string().uuid().nullable(),
  artifact: z.object({ artifactId: z.string().uuid(), versionId: z.string().uuid(), version: z.number().int() }).nullable(),
  createdAt: z.string(),
});
export type TurnSummary = z.infer<typeof turnSummarySchema>;

export const executionEventSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  name: z.string(),
  payload: z.unknown().nullable(),
  payloadTruncated: z.boolean(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
});
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
