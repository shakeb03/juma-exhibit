import type { MetricName } from "@exhibit/contracts";

/** The only metrics that leave a client under performance-pattern approval: rates, never raw totals. */
export const SHARED_METRICS = [
  "ctr",
  "conversionRate",
  "clicksPer1kImpressions",
  "conversionsPer1kImpressions",
  "cpm",
  "roas",
] as const satisfies readonly MetricName[];
export type SharedMetricName = (typeof SHARED_METRICS)[number];

export interface NormalizedMetrics {
  values: Record<SharedMetricName, number | null>;
  /** Why a metric is null, so "unavailable" is never confused with zero. */
  unavailable: Partial<Record<SharedMetricName, string>>;
}

export interface CampaignPattern {
  /** Citable reference, e.g. "ridgeline-outfitters:RL-PIN-0901". */
  ref: string;
  campaignId: string;
  channel: string;
  period: string;
  attributionWindow: string;
  currency: string;
  /** Coarse bands instead of raw totals, so differences in scale can still be stated as limitations. */
  scale: { impressionsBand: string; spendBand: string };
  metrics: NormalizedMetrics;
  /** Present only when creative assets are also approved. */
  creative?: { ref: string; visualStyle: string; storytelling: string; format: string };
}

export interface CreativeEntry {
  ref: string;
  refId: string;
  campaignId: string | null;
  title: string;
  description: string;
  visualStyle: string;
  storytelling: string;
  format: string;
  /** Says whether this is a text description or an inspected image. */
  assetNote: string;
}

export interface PatternGroup {
  value: string;
  campaigns: number;
  refs: string[];
  overall: NormalizedMetrics;
  /** The same grouping within each channel, which separates channel effects from creative effects. */
  byChannel: { channel: string; campaigns: number; metrics: NormalizedMetrics }[];
  warnings: string[];
}

export interface ClientContext {
  clientId: string;
  slug: string;
  name: string;
  performanceApproved: boolean;
  creativeApproved: boolean;
  campaigns: CampaignPattern[];
  creativeReferences: CreativeEntry[];
  /** Grouped patterns exist only when both performance and creative approvals are present. */
  patterns: { visualStyle: PatternGroup[]; storytelling: PatternGroup[] };
}

export interface ExplicitContext {
  ref: string;
  kind: "brief" | "reference" | "idea";
  title: string;
  text: string;
}

export interface Exclusion {
  /** What was left out, for the run overview and geek panel. Never contains the excluded content. */
  subject: string;
  category: "performance_patterns" | "creative_assets" | "source" | "node";
  reason: string;
}

export interface IntelligenceContext {
  chatNodeId: string;
  connectedNodeIds: string[];
  clients: ClientContext[];
  explicit: ExplicitContext[];
  exclusions: Exclusion[];
  /** Every reference a model may cite. Anything else in model output is invalid. */
  refs: string[];
  permissionFingerprint: string;
  sourceFingerprint: string;
}

export class ContextLimitError extends Error {
  constructor(
    public readonly code: "context_too_large" | "source_too_large",
    message: string,
  ) {
    super(message);
    this.name = "ContextLimitError";
  }
}

export class CanvasError extends Error {
  constructor(
    public readonly code: "chat_node_missing" | "invalid_canvas",
    message: string,
  ) {
    super(message);
    this.name = "CanvasError";
  }
}
