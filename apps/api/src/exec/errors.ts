/** The user (or an expired lease) stopped the run. Never marked as complete. */
export class CancelledError extends Error {
  constructor(message = "The run was cancelled.") {
    super(message);
    this.name = "CancelledError";
  }
}

/** This worker no longer holds the execution; it must stop writing. */
export class LeaseLostError extends Error {
  constructor() {
    super("The execution lease was lost.");
    this.name = "LeaseLostError";
  }
}

/** Token or call budget exhausted. Not retried automatically. */
export class BudgetError extends Error {
  constructor(
    public readonly code: "token_budget_exhausted" | "model_call_limit" | "runtime_limit" | "tool_step_limit",
    message: string,
  ) {
    super(message);
    this.name = "BudgetError";
  }
}

/** The model's output failed validation even after the single allowed repair. */
export class ValidationFailure extends Error {
  constructor(
    message: string,
    public readonly problems: string[],
  ) {
    super(message);
    this.name = "ValidationFailure";
  }
}

/** Connection-level database failures worth retrying at the execution level. */
export function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";
  return /^(08|53|57P0[1-3])/.test(code) || ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].includes(code);
}

/** Sharing or source content changed while a cross-client run was in progress, so its result must not be saved. */
export class ContextChangedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`The approved context changed during the run: ${reasons.join(" ")}`);
    this.name = "ContextChangedError";
  }
}
