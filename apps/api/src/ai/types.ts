export type TaskName = "interpret" | "explain" | "cross_client" | "edit_block" | "vision" | "concepts" | "extract";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolChoice = "auto" | "required" | "none" | { type: "function"; function: { name: string } };

export interface ChatRequest {
  task: TaskName;
  /** Primary model first, then explicitly configured fallbacks. */
  models: string[];
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  message: ChatMessage;
  finishReason: string | null;
  requestedModel: string;
  /** The model that actually answered, which can differ when a fallback was used. */
  actualModel: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Cost reported by the provider gateway; null when it was not supplied. */
  costUsd: number | null;
  durationMs: number;
  requestPayload: unknown;
  responsePayload: unknown;
}

export interface ModelClient {
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** Failure from a model call. `retryable` marks transient network and provider errors. */
export class ModelError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly requestPayload?: unknown,
    public readonly responsePayload?: unknown,
    public readonly durationMs?: number,
  ) {
    super(message);
    this.name = "ModelError";
  }
}
