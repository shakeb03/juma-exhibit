import { z } from "zod";
import type { Block } from "./blocks.js";

/**
 * The text fields a person can change by hand or by comment. Everything else on a block (its ID, type, the
 * metrics and sources it cites, which observations it rests on) is structure and stays as it was.
 */
export const EDITABLE_FIELDS: { [T in Block["type"]]: readonly string[] } = {
  heading: ["text"],
  paragraph: ["text"],
  metric_table: ["caption"],
  observation: ["text"],
  hypothesis: ["text"],
  recommendation: ["text", "reasoning", "measurement", "limitation"],
  experiment: ["title", "hypothesis", "design", "measurement", "limitation"],
  limitation: ["text"],
};

const fieldText = z.string().trim().max(4000);

export const manualEditRequestSchema = z.object({
  /** The version the person was looking at. A save against anything but the latest version is refused. */
  baseVersionId: z.string().uuid(),
  blockId: z.string().min(1).max(100),
  /** Only the fields that changed. Fields left out keep their stored text, including metric placeholders. */
  fields: z.record(z.string(), fieldText).refine((f) => Object.keys(f).length > 0 && Object.keys(f).length <= 6, "Change at least one field."),
});
export type ManualEditRequest = z.infer<typeof manualEditRequestSchema>;

export const createCommentRequestSchema = z.object({
  blockId: z.string().min(1).max(100),
  body: z.string().trim().min(1, "Write a comment.").max(1000),
  /** Text the reader highlighted inside the block, when the comment is about part of it. */
  selection: z.string().trim().min(1).max(500).optional(),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const commentStatusSchema = z.enum(["open", "proposed", "accepted", "rejected", "stale", "failed"]);
export type CommentStatus = z.infer<typeof commentStatusSchema>;
