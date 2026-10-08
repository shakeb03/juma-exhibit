import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createPool, type Database } from "@exhibit/database";
import { runCommentEdit } from "../agent/commentEdit.js";
import { runTurn } from "../agent/runTurn.js";
import { buildApp } from "../app.js";
import { loadConfig, type Config } from "../config.js";
import { Worker } from "../exec/worker.js";
import { ModelError, type ChatMessage, type ChatRequest, type ChatResult, type ModelClient, type ToolCall } from "../ai/types.js";
import { SESSION_COOKIE } from "../session/plugin.js";

let counter = 0;
export const toolCall = (name: string, args: unknown = {}): ToolCall => ({
  id: `call_${++counter}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

export type ScriptStep = ToolCall[] | Error | { content: string } | { calls: ToolCall[]; finishReason: string };
export type Script = (request: ChatRequest, index: number, history: ChatRequest[]) => ScriptStep | Promise<ScriptStep>;

/** A deterministic stand-in for OpenRouter. Records every request so tests can inspect what the model was sent. */
export class ScriptedModel implements ModelClient {
  readonly requests: ChatRequest[] = [];
  constructor(private script: Script, private readonly usage = { input: 400, output: 120 }) {}

  setScript(script: Script) {
    this.script = script;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const index = this.requests.length;
    // Snapshot the messages: the caller keeps appending to its array after this call returns.
    const snapshot = { ...request, messages: request.messages.map((m) => ({ ...m })) };
    this.requests.push(snapshot);
    const step = await this.script(snapshot, index, this.requests);
    if (step instanceof Error) throw step;
    const calls = Array.isArray(step) ? step : "calls" in step ? step.calls : null;
    const message: ChatMessage = calls ? { role: "assistant", content: null, tool_calls: calls } : { role: "assistant", content: (step as { content: string }).content };
    return {
      message, finishReason: !Array.isArray(step) && "finishReason" in step ? step.finishReason : "stop", requestedModel: request.models[0]!, actualModel: `fake/${request.task}`, provider: "FakeProvider",
      inputTokens: this.usage.input, outputTokens: this.usage.output, costUsd: 0.001, durationMs: 3,
      requestPayload: { model: request.models[0], messages: request.messages, tools: request.tools?.map((t) => t.function.name), max_tokens: request.maxTokens },
      responsePayload: { choices: [{ message }] },
    };
  }
}

/** Parse the JSON results of tool messages that follow the last assistant message. */
export interface ToolResult {
  name?: string;
  // Tool results are arbitrary JSON; tests narrow what they need.
  value: Record<string, unknown> & { scopeId?: string; campaigns?: { campaignId: string }[]; comparisons?: unknown[]; metrics?: unknown[] };
}

export function recentToolResults(request: ChatRequest): ToolResult[] {
  const out: ToolResult[] = [];
  const messages = request.messages;
  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  const calls = new Map<string, string>();
  for (const m of messages) for (const c of m.tool_calls ?? []) calls.set(c.id, c.function.name);
  for (const m of messages.slice(lastAssistant + 1)) {
    if (m.role !== "tool" || !m.content) continue;
    try {
      out.push({ name: calls.get(m.tool_call_id ?? ""), value: JSON.parse(m.content) as ToolResult["value"] });
    } catch {
      out.push({ name: calls.get(m.tool_call_id ?? ""), value: { raw: m.content } });
    }
  }
  return out;
}

export const phase = (request: ChatRequest) => (request.task === "explain" ? "compose" : "gather");
export const retryable = (message = "overloaded") => new ModelError(message, true, 503);

export interface Harness {
  config: Config;
  db: Database;
  app: FastifyInstance;
  secret: Record<string, string>;
  created: string[];
  newWorld(): Promise<World>;
  worker(model: ModelClient, overrides?: Partial<ConstructorParameters<typeof Worker>[0]>): Worker;
  drain(worker: Worker, max?: number): Promise<number>;
  close(): Promise<void>;
}

export interface World {
  agencyId: string;
  cookie: string;
  csrf: string;
  client: Record<string, string>;
  source: Record<string, string>;
  headers: Record<string, string>;
  post(url: string, payload: unknown, extra?: Record<string, string>): Promise<LightMyRequestResponse>;
  get(url: string): Promise<LightMyRequestResponse>;
  submit(slug: string, message: string, options?: { attachments?: string[]; referencedVersionId?: string; key?: string }): Promise<{ turnId: string; executionId: string; conversationId: string }>;
}

/** Real Neon database and real app routes; only the model is scripted. Every agency created is deleted in close(). */
export function createHarness(): Harness {
  const config = loadConfig({ ...process.env, BACKEND_PROXY_SECRET: "integration-test-secret-0123456789" } as NodeJS.ProcessEnv);
  const db = createPool({ connectionString: config.databaseUrl, max: 4 });
  const app = buildApp(config, { pingDatabase: async () => {}, db, sessionConfig: { ...config, sessionCreatesPerHour: 10_000 }, logger: false });
  const secret = { "x-proxy-secret": config.proxySecret };
  const created: string[] = [];
  let ip = 1;

  return {
    config, db, app, secret, created,
    async newWorld(): Promise<World> {
      const res = await app.inject({ method: "POST", url: "/v1/session", payload: {}, headers: { ...secret, "x-client-ip": `198.18.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}` } });
      if (res.statusCode !== 201) throw new Error(`Session creation failed: ${res.body}`);
      const agencyId = res.json().agencyId as string;
      created.push(agencyId);
      const clients = await db.query("select id, slug from clients where agency_id = $1", [agencyId]);
      const sources = await db.query("select id, name, client_id from sources where agency_id = $1", [agencyId]);
      const cookie = `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
      const csrf = res.json().csrfToken as string;
      const headers = { ...secret, cookie, "x-csrf-token": csrf };
      const world: World = {
        agencyId, cookie, csrf, headers,
        client: Object.fromEntries(clients.rows.map((r) => [r.slug, r.id])),
        source: Object.fromEntries(sources.rows.map((r) => [`${r.client_id ?? "none"}:${r.name}`, r.id])),
        post: async (url, payload, extra = {}) => app.inject({ method: "POST", url, payload: payload as object, headers: { ...headers, ...extra } }),
        get: async (url) => app.inject({ method: "GET", url, headers }),
        async submit(slug, message, options = {}) {
          const response = await world.post(`/v1/clients/${world.client[slug]}/turns`, {
            message, attachmentSourceIds: options.attachments ?? [], referencedVersionId: options.referencedVersionId,
          }, { "idempotency-key": options.key ?? `key-${Math.random().toString(36).slice(2)}-0000` });
          if (response.statusCode !== 202 && response.statusCode !== 200) throw new Error(`Submit failed: ${response.body}`);
          const turn = await db.query("select conversation_id from turns where id = $1", [response.json().turnId]);
          return { turnId: response.json().turnId, executionId: response.json().executionId, conversationId: turn.rows[0].conversation_id };
        },
      };
      return world;
    },
    worker(model, overrides = {}) {
      return new Worker({
        db, models: model, routing: config.routing, handlers: { turn: (ctx, execution) => runTurn(ctx, execution.turnId!), comment_edit: (ctx, execution) => runCommentEdit(ctx, execution.commentId!) },
        backendCommit: "test-commit", payloadMaxBytes: config.payloadMaxBytes, runTimeoutMs: 30_000, leaseMs: 5_000,
        sleep: async () => {}, retryDelayMs: 1, ...overrides,
      });
    },
    async drain(worker, max = 10) {
      let ran = 0;
      while (ran < max && (await worker.runOne())) ran++;
      return ran;
    },
    async close() {
      if (created.length) await db.query("delete from agencies where id = any($1)", [created]);
      await db.end();
    },
  };
}
