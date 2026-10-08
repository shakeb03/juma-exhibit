import { describe, expect, it } from "vitest";
import { OpenRouterClient } from "./openrouter.js";
import { ModelError, type ChatRequest } from "./types.js";
import { DEFAULT_ROUTING, loadRouting, modelsFor, routingVersion } from "./routing.js";

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  task: "interpret", models: ["anthropic/claude-haiku-5.5", "openai/gpt-5.4-mini"],
  messages: [{ role: "user", content: "hi" }], maxTokens: 100, ...overrides,
});

function clientWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { client: new OpenRouterClient({ apiKey: "sk-or-test-key-123456", fetchImpl, referer: "https://example.test", title: "Exhibit A" }), calls };
}

const ok = (extra: object = {}) =>
  new Response(JSON.stringify({
    model: "anthropic/claude-haiku-5.5", provider: "Anthropic",
    choices: [{ message: { content: "hello", tool_calls: [{ id: "c1", type: "function", function: { name: "discover_sources", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0042 }, ...extra,
  }), { status: 200 });

describe("OpenRouterClient", () => {
  it("sends only the first model plus usage accounting, with no provider filters or fallback list that cause silent rerouting", async () => {
    const { client, calls } = clientWith(() => ok());
    await client.chat(request({ tools: [{ type: "function", function: { name: "t", description: "d", parameters: {} } }], toolChoice: "required" }));
    const sent = calls[0]!;
    expect(sent.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent.body.model).toBe("anthropic/claude-haiku-5.5");
    expect(sent.body.models).toBeUndefined(); // fallbacks are the caller's job, so each attempt is recorded
    expect(sent.body.usage).toEqual({ include: true });
    expect(sent.body.provider).toBeUndefined();
    expect(sent.body.tool_choice).toBe("required");
    expect(sent.headers.Authorization).toBe("Bearer sk-or-test-key-123456");
  });

  it("reads the message, tool calls, actual model, provider, tokens, and cost", async () => {
    const { client } = clientWith(() => ok({ model: "openai/gpt-5.4-mini", provider: "OpenAI" }));
    const result = await client.chat(request());
    expect(result.message.tool_calls?.[0]?.function.name).toBe("discover_sources");
    expect(result.requestedModel).toBe("anthropic/claude-haiku-5.5");
    expect(result.actualModel).toBe("openai/gpt-5.4-mini"); // a fallback answered, and we say so
    expect(result.provider).toBe("OpenAI");
    expect([result.inputTokens, result.outputTokens, result.costUsd]).toEqual([120, 30, 0.0042]);
  });

  it("reports missing usage honestly as null", async () => {
    const { client } = clientWith(() => new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), { status: 200 }));
    const result = await client.chat(request());
    expect([result.inputTokens, result.outputTokens, result.costUsd, result.provider, result.actualModel]).toEqual([null, null, null, null, null]);
  });

  it.each([[429, true], [500, true], [503, true], [408, true], [400, false], [401, false], [402, false]])("classifies HTTP %i as retryable=%s", async (status, retryable) => {
    const { client } = clientWith(() => new Response(JSON.stringify({ error: { message: "nope" } }), { status }));
    const error = await client.chat(request()).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.retryable).toBe(retryable);
    expect(error.status).toBe(status);
  });

  it("treats an error body inside a 200 as a failure", async () => {
    const { client } = clientWith(() => new Response(JSON.stringify({ error: { code: 429, message: "rate limited" } }), { status: 200 }));
    const error = await client.chat(request()).catch((e) => e);
    expect(error.retryable).toBe(true);
  });

  it("retries a response with no choices, and network failures", async () => {
    const empty = await clientWith(() => new Response(JSON.stringify({ choices: [] }), { status: 200 })).client.chat(request()).catch((e) => e);
    expect(empty.retryable).toBe(true);
    const network = await clientWith(() => { throw new Error("socket hang up"); }).client.chat(request()).catch((e) => e);
    expect(network.retryable).toBe(true);
    expect(network.message).toMatch(/socket hang up/);
  });

  it("does not retry a cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = clientWith(() => { throw new DOMException("aborted", "AbortError"); });
    const error = await client.chat(request({ signal: controller.signal })).catch((e) => e);
    expect(error.retryable).toBe(false);
  });

  it("never puts the API key in the recorded request payload", async () => {
    const { client } = clientWith(() => ok());
    const result = await client.chat(request());
    expect(JSON.stringify(result.requestPayload)).not.toContain("sk-or-test-key");
  });
});

describe("routing", () => {
  it("uses several model families by default", () => {
    const families = new Set(Object.values(DEFAULT_ROUTING).flatMap((r) => [r.primary, ...r.fallbacks]).map((m) => m.split("/")[0]));
    expect(families.size).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_ROUTING.interpret.primary).not.toBe(DEFAULT_ROUTING.explain.primary);
  });

  it("can be overridden per task by environment, and the version changes when it does", () => {
    const base = loadRouting({});
    const changed = loadRouting({ MODEL_EXPLAIN: "openai/gpt-5.5", MODEL_EXPLAIN_FALLBACKS: "anthropic/claude-opus-5.5, google/gemini-3.7-flash", MODEL_EXPLAIN_MAX_TOKENS: "3000" });
    expect(modelsFor(changed, "explain")).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-5.5", "google/gemini-3.7-flash"]);
    expect(changed.explain.maxTokens).toBe(3000);
    expect(modelsFor(changed, "interpret")).toEqual(modelsFor(base, "interpret"));
    expect(routingVersion(changed)).not.toBe(routingVersion(base));
    expect(routingVersion(base)).toBe(routingVersion(loadRouting({})));
  });
});
