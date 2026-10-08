import { createHash } from "node:crypto";
import type { TaskName } from "./types.js";

export interface TaskRoute {
  primary: string;
  fallbacks: string[];
  maxTokens: number;
}

export type RoutingTable = Record<TaskName, TaskRoute>;

/**
 * Starting hypotheses, not claims of superior performance. Several families are used on purpose,
 * and each task can be overridden with MODEL_<TASK> and MODEL_<TASK>_FALLBACKS (comma separated).
 * Changing any value changes the routing version, which should trigger the evaluation cases again.
 */
export const DEFAULT_ROUTING: RoutingTable = {
  // Cheap, fast tool use: choosing sources, calling calculators.
  interpret: { primary: "anthropic/claude-haiku-5.5", fallbacks: ["openai/gpt-5.4-mini"], maxTokens: 1500 },
  // Writing the answer and report text.
  explain: { primary: "anthropic/claude-sonnet-5.5", fallbacks: ["openai/gpt-5.6-sol"], maxTokens: 8000 },
  // Comparing patterns across clients.
  cross_client: { primary: "openai/gpt-5.6-sol", fallbacks: ["anthropic/claude-sonnet-5.5"], maxTokens: 6000 },
  // Rewriting a single block from a comment.
  edit_block: { primary: "anthropic/claude-haiku-5.5", fallbacks: ["openai/gpt-5.4-mini"], maxTokens: 1500 },
  // Reading actual image bytes.
  vision: { primary: "google/gemini-3.6-flash", fallbacks: ["anthropic/claude-sonnet-5.5"], maxTokens: 2000 },
  // Campaign concepts and experiment briefs.
  concepts: { primary: "anthropic/claude-sonnet-5.5", fallbacks: ["openai/gpt-5.6-sol"], maxTokens: 6000 },
  // Short structured extraction and summaries.
  extract: { primary: "google/gemini-3.1-flash-lite", fallbacks: ["openai/gpt-5.4-nano"], maxTokens: 1500 },
};

const csv = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

export function loadRouting(env: NodeJS.ProcessEnv = process.env): RoutingTable {
  const table = {} as RoutingTable;
  for (const task of Object.keys(DEFAULT_ROUTING) as TaskName[]) {
    const key = task.toUpperCase();
    const base = DEFAULT_ROUTING[task];
    const maxTokens = Number(env[`MODEL_${key}_MAX_TOKENS`]);
    table[task] = {
      primary: env[`MODEL_${key}`]?.trim() || base.primary,
      fallbacks: csv(env[`MODEL_${key}_FALLBACKS`]) ?? base.fallbacks,
      maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : base.maxTokens,
    };
  }
  return table;
}

/** Short stable identifier recorded with every execution. */
export function routingVersion(table: RoutingTable): string {
  return createHash("sha256").update(JSON.stringify(table)).digest("hex").slice(0, 12);
}

export function modelsFor(table: RoutingTable, task: TaskName): string[] {
  const route = table[task];
  return [route.primary, ...route.fallbacks];
}
