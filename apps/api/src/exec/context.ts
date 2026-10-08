import type { Database } from "@exhibit/database";
import type { RoutingTable } from "../ai/routing.js";
import type { ExecutionRecorder } from "./recorder.js";
import type { ModelCaller } from "./modelCaller.js";

/** Everything a handler needs to run one execution, and to prove it still may. */
export interface RunContext {
  db: Database;
  agencyId: string;
  executionId: string;
  /** Lease owner. Commits are only accepted while this worker holds the lease. */
  owner: string;
  backendCommit: string | null;
  routing: RoutingTable;
  routingVersion: string;
  recorder: ExecutionRecorder;
  models: ModelCaller;
  /** Throws if the run was cancelled or the lease was lost. Call between steps. */
  checkpoint(): Promise<void>;
}
