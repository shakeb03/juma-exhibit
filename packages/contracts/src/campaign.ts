import { z } from "zod";

/** Blank CSV cells arrive as null: a missing measurement is not zero. */
const nullableNumber = z.number().finite().nonnegative().nullable();

export const campaignRowSchema = z.object({
  campaignId: z.string().min(1),
  campaignName: z.string().min(1),
  channel: z.string().min(1),
  period: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3),
  spend: nullableNumber,
  impressions: nullableNumber,
  clicks: nullableNumber,
  conversions: nullableNumber,
  revenue: nullableNumber,
  attributionWindow: z.string().min(1),
  creativeRefId: z.string().nullable(),
});
export type CampaignRow = z.infer<typeof campaignRowSchema>;

export const metricNameSchema = z.enum([
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "revenue",
  "ctr",
  "conversionRate",
  "cpc",
  "costPerConversion",
  "roas",
  "cpm",
  "clicksPer1kImpressions",
  "conversionsPer1kImpressions",
]);
export type MetricName = z.infer<typeof metricNameSchema>;

/**
 * One calculated metric, with everything the evidence drawer needs:
 * the value (or why it is unavailable), the formula, and the exact inputs and rows used.
 */
export const metricSchema = z.object({
  id: z.string(),
  name: metricNameSchema,
  value: z.number().nullable(),
  unavailableReason: z.string().nullable(),
  formula: z.string(),
  inputs: z.record(z.string(), z.number().nullable()),
  rowIds: z.array(z.string()),
  currency: z.string().nullable(),
});
export type Metric = z.infer<typeof metricSchema>;

export const metricSetSchema = z.object({
  scope: z.string(),
  rowIds: z.array(z.string()),
  metrics: z.record(metricNameSchema, metricSchema),
  /** Problems that make the set partly or wholly unreliable (mixed currency, mixed attribution). */
  warnings: z.array(z.string()),
});
export type MetricSet = z.infer<typeof metricSetSchema>;
