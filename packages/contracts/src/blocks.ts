import { z } from "zod";
import { metricNameSchema } from "./campaign.js";

/**
 * Artifacts are ordered lists of blocks. Every block has a stable ID, so a comment or edit can target
 * exactly one block. Text may contain {{metric-id}} placeholders; the renderer fills in verified
 * values from metric records, so models never write the numbers themselves.
 */

const text = z.string().trim().min(1).max(4000);
// Models often omit empty lists; a missing list simply means none.
const ids = z.array(z.string().min(1)).max(40).default([]);

export const artifactKindSchema = z.enum([
  "performance_report",
  "campaign_brief",
  "client_summary",
  "campaign_concepts",
  "experiment_plan",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

const heading = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string().trim().min(1).max(200),
});
const paragraph = z.object({ type: z.literal("paragraph"), text });
const metricTable = z.object({
  type: z.literal("metric_table"),
  caption: z.string().trim().max(300),
  scopes: z.array(z.object({ label: z.string().min(1).max(120), scopeId: z.string().min(1) })).min(1).max(8),
  metrics: z.array(metricNameSchema).min(1).max(12),
});
// What the data shows. Must cite metrics or sources and may not state causes.
const observation = z.object({ type: z.literal("observation"), text, metricIds: ids, sourceRefs: ids });
// A possible explanation. Always untested.
const hypothesis = z.object({ type: z.literal("hypothesis"), text, basedOn: ids, sourceRefs: ids });
// A proposed action, with its reasoning, how to measure it, and its limits.
const recommendation = z.object({
  type: z.literal("recommendation"),
  text,
  reasoning: text,
  basedOn: ids,
  measurement: text,
  limitation: text,
});
const experiment = z.object({
  type: z.literal("experiment"),
  title: z.string().trim().min(1).max(200),
  hypothesis: text,
  design: text,
  measurement: text,
  limitation: text,
  basedOn: ids,
});
const limitation = z.object({ type: z.literal("limitation"), text });

/** Stored blocks always carry their ID. */
const stored = { id: z.string().min(1) };
export const blockSchema = z.discriminatedUnion("type", [
  heading.extend(stored),
  paragraph.extend(stored),
  metricTable.extend(stored),
  observation.extend(stored),
  hypothesis.extend(stored),
  recommendation.extend(stored),
  experiment.extend(stored),
  limitation.extend(stored),
]);
export type Block = z.infer<typeof blockSchema>;

/**
 * Blocks as a model proposes them. `id` reuses an existing block when revising; `key` is a temporary
 * label so new blocks can be referenced from `basedOn` before IDs exist.
 */
const draft = { id: z.string().min(1).optional(), key: z.string().min(1).max(40).optional() };
export const blockDraftSchema = z.discriminatedUnion("type", [
  heading.extend(draft),
  paragraph.extend(draft),
  metricTable.extend(draft),
  observation.extend(draft),
  hypothesis.extend(draft),
  recommendation.extend(draft),
  experiment.extend(draft),
  limitation.extend(draft),
]);
export type BlockDraft = z.infer<typeof blockDraftSchema>;

export const artifactDraftSchema = z.object({
  action: z.enum(["create", "update"]),
  kind: artifactKindSchema.optional(),
  title: z.string().trim().min(1).max(200),
  blocks: z.array(blockDraftSchema).min(1).max(60),
});
export type ArtifactDraft = z.infer<typeof artifactDraftSchema>;

/** A chat answer is a few labelled statements, not one block of prose. */
export const replyStatementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("observation"), text, metricIds: ids, sourceRefs: ids }),
  z.object({ type: z.literal("hypothesis"), text }),
  z.object({ type: z.literal("recommendation"), text, reasoning: text, measurement: text, limitation: text }),
  z.object({ type: z.literal("note"), text }),
]);
export type ReplyStatement = z.infer<typeof replyStatementSchema>;

export const agentReplySchema = z.object({
  message: z.string().trim().min(1).max(1500),
  // When an artifact carries the content, a short reply may send no statements at all.
  statements: z.array(replyStatementSchema).max(12).default([]),
  followUp: z.string().trim().max(500).optional(),
});
export type AgentReply = z.infer<typeof agentReplySchema>;

export const finishArgsSchema = z.object({
  reply: agentReplySchema,
  artifact: artifactDraftSchema.optional(),
});
export type FinishArgs = z.infer<typeof finishArgsSchema>;
