import type { AgentReply, Block, ClientSummary, SourceSummary } from "@exhibit/contracts";

export type { AgentReply, Block, ClientSummary, SourceSummary };

/** A calculated metric plus its display string, as returned with replies and artifact versions. */
export interface Metric {
  id: string;
  label: string;
  unit: "count" | "currency" | "percent" | "multiple" | "per1k";
  change: "none" | "absolute" | "relative";
  value: number | null;
  unavailableReason: string | null;
  formula: string;
  inputs: Record<string, number | null>;
  rowIds: string[];
  currency: string | null;
  display: string;
}

export interface ReplyView {
  kind: "answer" | "clarification" | "failure";
  message: string | null;
  options?: string[];
  statements?: AgentReply["statements"];
  followUp?: string;
  /** Same reply with {{metric-id}} placeholders intact. */
  raw?: AgentReply;
  claims?: { verified: number; total: number } | null;
  evidence?: Record<string, Metric>;
}

export type TurnStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Turn {
  id: string;
  seq: number;
  userMessage: string;
  attachmentSourceIds: string[];
  status: TurnStatus;
  replyKind: "answer" | "clarification" | "failure" | null;
  reply: ReplyView | null;
  executionId: string | null;
  artifact: { artifactId: string; versionId: string; version: number } | null;
  createdAt: string;
}

export interface ConversationView {
  conversationId: string;
  turns: Turn[];
}

export interface ClientProfile {
  id: string;
  slug: string;
  name: string;
  category: string;
  brandVoice: string;
  audience: string;
  goals: string;
  constraints: string;
  standingInstructions: string;
  reportingPeriod: { first: string; last: string } | null;
  sources: Pick<SourceSummary, "id" | "kind" | "name" | "mimeType" | "sizeBytes" | "status">[];
}

export interface ArtifactVersionView {
  id: string;
  artifactId: string;
  version: number;
  kind: string;
  causeKind: string;
  causeTurnId: string | null;
  createdAt: string;
  blocks: Block[];
  renderedBlocks: Block[];
  metrics: Record<string, Metric>;
  scopes: { scopeId: string; label: string; campaignIds: string[]; warnings: string[] }[];
  checks: { claims?: { verified: number; total: number }; warnings?: { path: string; message: string }[] };
}

export interface ArtifactSummary {
  artifact: { id: string; kind: string; title: string; currentVersionId: string | null };
  versions: { id: string; version: number; causeKind: string; causeTurnId: string | null; approved: boolean; createdAt: string }[];
}

export interface ExecutionEventView {
  id: number;
  kind: string;
  name: string;
  payload: unknown;
  payloadTruncated: boolean;
  durationMs: number | null;
  createdAt: string;
}

export interface ExecutionView {
  id: string;
  kind: string;
  status: "queued" | "running" | "waiting_to_retry" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  turnId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string | null } | null;
}

export interface SourcePreview {
  id: string;
  clientId: string | null;
  kind: string;
  name: string;
  text: string;
  truncated: boolean;
  totalChars: number;
}
