import type { JsonObject } from "../step2-collect/types.js";
import type { PublishOrchestratorConfig } from "./publishOrchestratorConfig.js";

export type TaskJson = JsonObject;

export type OutboxEventStatus = "pending" | "processing" | "done" | "failed";
export type OutboxEventType = "TASK_UPDATED" | "TASK_RECONCILE" | "TASK_TIMEOUT";

export type OutboxEvent = {
  event_id: string;
  event_type: OutboxEventType;
  task_id: string;
  run_id: string;
  revision: number;
  payload_json: string;
  status: OutboxEventStatus;
  retry_count: number;
  next_retry_at: string;
  locked_at?: string | null;
  locked_by?: string | null;
  created_at: string;
  processed_at?: string | null;
};

export type OrchestratorSettings = {
  workspaceDir: string;
  repoRoot: string;
  dataDir: string;
  tasksDir: string;
  logsDir: string;
  dbPath: string;
  publishConfig: PublishOrchestratorConfig;
};

export type UpdateTaskContext = {
  now: string;
  previousRevision: number;
};

export type UpdateTaskParams = {
  taskJsonPath: string;
  reason: string;
  changedFields?: string[];
  operator?: string;
  payload?: JsonObject;
  mutate: (task: TaskJson, context: UpdateTaskContext) => void | Promise<void>;
};

export type UpdateTaskResult = {
  taskJsonPath: string;
  task: TaskJson;
  event: OutboxEvent;
};

export type NextAction =
  | { type: "EXECUTE_STEP2_COLLECT"; reason: string }
  | { type: "ADVANCE_TO_COLLECTED"; reason: string }
  | { type: "ADVANCE_TO_COLLECTED_DEGRADED"; reason: string }
  | { type: "EXECUTE_TIDY"; reason: string }
  | { type: "ADVANCE_TO_ANALYZED"; reason: string }
  | { type: "EXECUTE_STEP4_SLACK_NOTIFY"; reason: string }
  | { type: "EXECUTE_STEP4_GENERATE_RESEARCH"; reason: string }
  | { type: "EXECUTE_STEP6_GENERATE_COPY"; reason: string }
  | { type: "EXECUTE_STEP6_GENERATE_IMAGES"; reason: string }
  | { type: "EXECUTE_STEP7_PUBLISH"; reason: string }
  | { type: "NOOP"; reason: string };
