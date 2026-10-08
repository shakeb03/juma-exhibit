import { ModelError, type ChatMessage, type ChatRequest, type ChatResult, type ModelClient } from "./types.js";

/** The parts of an OpenRouter chat response this client reads. */
interface GatewayResponse {
  error?: { code?: unknown; message?: string };
  choices?: { message?: { content?: unknown; tool_calls?: ChatMessage["tool_calls"] }; finish_reason?: string }[];
  model?: string;
  provider?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Sent so OpenRouter can attribute traffic; harmless if omitted. */
  referer?: string;
  title?: string;
  fetchImpl?: typeof fetch;
}

/** One attempt per call. Retries and budgets are handled by the caller so every attempt is recorded. */
export class OpenRouterClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterOptions) {
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    // One model per request. Fallbacks are handled by the caller, one recorded attempt at a time: sending
    // OpenRouter a fallback list made it reroute away from the primary model even when it was healthy.
    const primary = request.models[0];
    if (!primary) throw new ModelError("No model configured for this task.", false);

    const body: Record<string, unknown> = {
      model: primary,
      messages: request.messages,
      max_tokens: request.maxTokens,
      // Ask the gateway to report token usage and cost.
      usage: { include: true },
      // Deliberately no provider.require_parameters: combined with tool_choice it filters out every
      // Anthropic endpoint and silently reroutes to a fallback model family. Model and tool support is
      // verified by evaluation, and the model that actually answered is always recorded.
    };
    if (request.tools?.length) body.tools = request.tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const started = Date.now();
    const timeout = AbortSignal.timeout(request.timeoutMs ?? 90_000);
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          ...(this.options.referer ? { "HTTP-Referer": this.options.referer } : {}),
          ...(this.options.title ? { "X-Title": this.options.title } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const aborted = request.signal?.aborted === true;
      throw new ModelError(
        aborted ? "The request was cancelled." : `Network error calling the model: ${(error as Error).message}`,
        !aborted,
        undefined,
        body,
        undefined,
        Date.now() - started,
      );
    }

    // Measure after the body arrives: headers can come early while the model is still generating.
    const raw = await response.text();
    const durationMs = Date.now() - started;
    let json: GatewayResponse;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ModelError(`The model gateway returned a non-JSON response (status ${response.status}).`, response.status >= 500, response.status, body, raw.slice(0, 2000), durationMs);
    }

    if (!response.ok || json.error) {
      const status: number = typeof json.error?.code === "number" && Number.isInteger(json.error.code) ? json.error.code : response.status;
      const retryable = status === 408 || status === 429 || status >= 500;
      throw new ModelError(`Model request failed (${status}): ${json.error?.message ?? "unknown error"}`, retryable, status, body, json, durationMs);
    }

    const choice = json.choices?.[0];
    if (!choice?.message) {
      // A 200 with no choices is a provider hiccup worth one retry.
      throw new ModelError("The model returned no message.", true, response.status, body, json, durationMs);
    }
    const message: ChatMessage = {
      role: "assistant",
      content: typeof choice.message.content === "string" ? choice.message.content : null,
      ...(choice.message.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : {}),
    };

    return {
      message,
      finishReason: choice.finish_reason ?? null,
      requestedModel: primary,
      actualModel: json.model ?? null,
      provider: json.provider ?? null,
      inputTokens: json.usage?.prompt_tokens ?? null,
      outputTokens: json.usage?.completion_tokens ?? null,
      costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
      durationMs,
      requestPayload: body,
      responsePayload: json,
    };
  }
}
