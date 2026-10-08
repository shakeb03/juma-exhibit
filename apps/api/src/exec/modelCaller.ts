import { reserveTokens, settleTokens, type Database } from "@exhibit/database";
import type { ChatRequest, ChatResult, ModelClient, TaskName } from "../ai/types.js";
import { ModelError } from "../ai/types.js";
import { modelsFor, type RoutingTable } from "../ai/routing.js";
import { BudgetError, CancelledError } from "./errors.js";
import type { ExecutionRecorder } from "./recorder.js";

export interface Limits {
  /** Model attempts per call, including the first. Two retries means three. */
  attemptsPerCall: number;
  /** Total model attempts allowed in one execution, shared by fallbacks, repairs, and retries. */
  maxModelCalls: number;
  /** Wall-clock limit for the whole execution. */
  deadlineAt: number;
  backoffMs: number;
}

export const DEFAULT_LIMITS = { attemptsPerCall: 3, maxModelCalls: 14, backoffMs: 500 } as const;

/** Rough token estimate used only to reserve budget before a call. */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

/**
 * Every model call in an execution goes through here. It enforces one shared budget for retries,
 * provider fallbacks, and repairs; reserves and settles tokens against the agency; and records each
 * attempt, including failed ones, so the technical page shows exactly what happened.
 */
export class ModelCaller {
  private attempts = 0;
  /** The candidate that last worked for each task, so a model that is down is not retried on every call. */
  private readonly working = new Map<TaskName, number>();

  constructor(
    private readonly deps: {
      db: Database;
      agencyId: string;
      client: ModelClient;
      routing: RoutingTable;
      recorder: ExecutionRecorder;
      limits: Limits;
      isCancelled: () => Promise<boolean>;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  get attemptCount(): number {
    return this.attempts;
  }

  async call(task: TaskName, request: Omit<ChatRequest, "task" | "models" | "maxTokens"> & { maxTokens?: number }): Promise<ChatResult> {
    const { db, agencyId, client, routing, recorder, limits } = this.deps;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const maxTokens = request.maxTokens ?? routing[task].maxTokens;
    const candidates = modelsFor(routing, task);
    const base = { ...request, task, maxTokens };

    // Candidates are tried in order. A transient error is retried once on the same model, then the next
    // model is used. Errors that are specific to a model or provider (400 and 404) advance immediately.
    // Everything shares one attempt limit and every attempt is recorded.
    let candidate = this.working.get(task) ?? 0;
    let retriesOnCandidate = 0;
    let lastError: unknown;

    for (let attempt = 1; attempt <= limits.attemptsPerCall; attempt++) {
      if (await this.deps.isCancelled()) throw new CancelledError();
      if (Date.now() >= limits.deadlineAt) throw new BudgetError("runtime_limit", "The run took too long and was stopped.");
      if (this.attempts >= limits.maxModelCalls) throw new BudgetError("model_call_limit", "The run reached its limit of model calls.");
      this.attempts++;

      const model = candidates[candidate]!;
      const full: ChatRequest = { ...base, models: [model] };
      const reserved = estimateTokens({ m: full.messages, t: full.tools }) + maxTokens;
      if (!(await reserveTokens(db, agencyId, reserved))) {
        throw new BudgetError("token_budget_exhausted", "This demo session has used its model budget.");
      }

      try {
        const result = await client.chat({ ...full, timeoutMs: Math.min(request.timeoutMs ?? 90_000, Math.max(1000, limits.deadlineAt - Date.now())) });
        await settleTokens(db, agencyId, reserved, (result.inputTokens ?? 0) + (result.outputTokens ?? 0) || reserved);
        if (candidate > 0) {
          // Report the switch once per run, then keep using the model that works.
          if (this.working.get(task) !== candidate) {
            await recorder.event("progress", "Fallback model used", { task, primary: candidates[0], used: model, actual: result.actualModel });
          }
          this.working.set(task, candidate);
        }
        await recorder.modelCall({
          task, attempt, requestedModel: result.requestedModel, actualModel: result.actualModel, provider: result.provider,
          requestPayload: result.requestPayload, responsePayload: result.responsePayload,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: result.durationMs, costUsd: result.costUsd,
        });
        return result;
      } catch (error) {
        await settleTokens(db, agencyId, reserved, 0);
        lastError = error;
        const failure = error instanceof ModelError ? error : null;
        await recorder.modelCall({
          task, attempt, requestedModel: model,
          requestPayload: failure?.requestPayload ?? { messages: full.messages.length },
          responsePayload: failure?.responsePayload, durationMs: failure?.durationMs,
          error: (error as Error).message,
        });
        if (!failure) throw error;

        const modelSpecific = failure.status === 400 || failure.status === 404;
        const hasNext = candidate + 1 < candidates.length;
        if (failure.retryable && retriesOnCandidate < 1) {
          retriesOnCandidate++;
          await sleep(limits.backoffMs * 2 ** (attempt - 1));
        } else if ((failure.retryable || modelSpecific) && hasNext) {
          candidate++;
          retriesOnCandidate = 0;
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  }
}
