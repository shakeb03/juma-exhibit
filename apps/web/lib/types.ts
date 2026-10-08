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
  /** Reasons this result no longer matches the current permissions or canvas text. Empty when it is current. */
  stale?: string[];
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

export interface ProducedBy {
  executionId: string | null;
  models: { task: string; model: string; provider: string | null }[];
}

export interface ModelCallView {
  id: string;
  task: string;
  attempt: number;
  requestedModel: string;
  actualModel: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  costUsd: number | null;
  costEstimated: boolean;
  error: string | null;
  payloadTruncated: boolean;
  createdAt: string;
}

export interface ArtifactVersionView {
  produced: ProducedBy;
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

export interface ExecutionDetail {
  id: string;
  kind: string;
  status: string;
  attempt: number;
  turnId: string | null;
  conversationId: string | null;
  seq: number | null;
  request: string | null;
  backendCommit: string | null;
  routingVersion: string | null;
  routingSnapshot: Record<string, { primary: string; fallbacks: string[]; maxTokens: number }> | null;
  inputSnapshot: {
    client?: { id: string; slug: string };
    attachments?: { id: string; name: string; kind: string }[];
    contextChecksums?: Record<string, string>;
    historyTurnIds?: string[];
    baseArtifact?: { artifactId: string; version: number; kind: string } | null;
    note?: string;
    exclusions?: { subject: string; category: string; reason: string }[];
    connected?: { id: string; type: string; title?: string }[];
  } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ModelPayload {
  request: unknown;
  response: unknown;
  truncated: boolean;
}

export interface RepositoryMeta {
  configured: boolean;
  owner: string | null;
  repository: string | null;
  backendCommit: string | null;
  defaultBranch: string;
}

export interface RepoTree {
  ref: string;
  pinned: boolean;
  entries: { path: string; size: number }[];
}

export interface RepoFile {
  ref: string;
  pinned: boolean;
  path: string;
  language: string;
  content: string;
  size: number;
}

export interface CanvasNodeData {
  id: string;
  type: "client" | "brief" | "reference" | "idea" | "chat";
  position: { x: number; y: number };
  clientId?: string;
  sourceId?: string;
  text?: string;
  title?: string;
}

export interface CanvasEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CanvasState {
  canvasId: string;
  revision: number;
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  updatedAt: string;
}

export interface PassportEntry {
  nodeId: string;
  type: "client" | "brief" | "reference" | "idea";
  title: string;
  status: "approved" | "partial" | "restricted" | "explicit";
  included: string[];
  excluded: string[];
  reasons: string[];
  fieldsShared: number;
}

export interface PassportView {
  revision: number;
  passport: { chatNodeId: string; entries: PassportEntry[]; neverShared: string[]; note: string };
  exclusions: { subject: string; category: string; reason: string }[];
}

export interface CanvasConversationView extends ConversationView {
  canvasRevision: number;
}
