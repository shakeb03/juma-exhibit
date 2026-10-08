import { insertEvent, insertModelCall, type Database, type ModelCallInput } from "@exhibit/database";
import { prepare } from "./redact.js";

/**
 * Writes the inspectable record of a run: ordered events and one row per model attempt.
 * Everything is redacted and size-bounded before storage; private model reasoning is never recorded,
 * only the messages sent and the content returned.
 */
export class ExecutionRecorder {
  constructor(
    private readonly db: Database,
    readonly executionId: string,
    private readonly payloadMaxBytes: number,
  ) {}

  async event(kind: string, name: string, payload?: unknown, durationMs?: number): Promise<void> {
    const prepared = prepare(payload, this.payloadMaxBytes);
    await insertEvent(this.db, this.executionId, {
      kind,
      name,
      payload: prepared.value,
      truncated: prepared.truncated,
      durationMs,
    });
  }

  /** Run a step and record its duration and outcome as one event. */
  async timed<T>(kind: string, name: string, input: unknown, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const result = await work();
      await this.event(kind, name, { input, result }, Date.now() - started);
      return result;
    } catch (error) {
      await this.event("error", name, { input, error: (error as Error).message }, Date.now() - started);
      throw error;
    }
  }

  async modelCall(call: Omit<ModelCallInput, "executionId" | "payloadTruncated">): Promise<void> {
    const request = prepare(call.requestPayload, this.payloadMaxBytes);
    const response = prepare(call.responsePayload, this.payloadMaxBytes);
    await insertModelCall(this.db, {
      ...call,
      executionId: this.executionId,
      requestPayload: request.value,
      responsePayload: response.value,
      payloadTruncated: request.truncated || response.truncated,
    });
  }
}
