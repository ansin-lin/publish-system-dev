import type { JsonObject } from "../../../node/src/step2-collect/types.js";
import { isTerminalStatus } from "../../../node/src/orchestrator/taskStore.js";
import type {
  DaySummaryDto,
  StepDto,
  StepStatus,
  TaskProgressDto,
  TaskSummaryDto,
  UiStepDto,
  UiStepStatus,
} from "../types/dto.js";
import { formatIsoDateFromYmd } from "../utils/dateJst.js";

const STEP_STATUSES = new Set<StepStatus>([
  "pending",
  "running",
  "success",
  "failed",
  "partial_failed",
  "init_failed",
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStepStatus(value: unknown): StepStatus | undefined {
  if (typeof value !== "string") return undefined;
  return STEP_STATUSES.has(value as StepStatus) ? (value as StepStatus) : undefined;
}

function readStep(steps: unknown, key: string): StepDto | undefined {
  if (!isObject(steps)) return undefined;
  const raw = steps[key];
  if (!isObject(raw)) return undefined;

  const status = asStepStatus(raw.status);
  if (!status) return undefined;

  const dto: StepDto = { status };
  if (typeof raw.started_at === "string") dto.started_at = raw.started_at;
  if (typeof raw.finished_at === "string") dto.finished_at = raw.finished_at;
  if (typeof raw.input_ref === "string") dto.input_ref = raw.input_ref;
  if (typeof raw.output_ref === "string") dto.output_ref = raw.output_ref;
  if (typeof raw.message_ts === "string") dto.message_ts = raw.message_ts;

  if (isObject(raw.error)) {
    dto.error = {
      ...(typeof raw.error.code === "string" ? { code: raw.error.code } : {}),
      ...(typeof raw.error.message === "string" ? { message: raw.error.message } : {}),
      ...(typeof raw.error.retryable === "boolean" ? { retryable: raw.error.retryable } : {}),
    };
  }

  return dto;
}

function mergeStatuses(...statuses: (StepStatus | undefined)[]): StepStatus {
  const list = statuses.filter((s): s is StepStatus => Boolean(s));
  if (!list.length) return "pending";
  if (list.some((s) => s === "failed" || s === "init_failed")) return "failed";
  if (list.some((s) => s === "partial_failed")) return "partial_failed";
  if (list.some((s) => s === "running")) return "running";
  if (list.every((s) => s === "success")) return "success";
  if (list.some((s) => s === "success")) return "running";
  return "pending";
}

function resolveCreateStatus(taskStatus: string): UiStepStatus {
  if (taskStatus === "created") return "running";
  return "success";
}

function resolveSelectionStatus(taskStatus: string, steps: unknown): UiStepStatus {
  if (taskStatus === "awaiting_manager_selection") return "waiting_human";
  return mergeStatuses(readStep(steps, "approval")?.status, readStep(steps, "approve")?.status);
}

function resolveGenerateStatus(steps: unknown): StepStatus {
  return mergeStatuses(readStep(steps, "copy")?.status, readStep(steps, "image")?.status);
}

function buildUiSteps(taskStatus: string, steps: unknown): UiStepDto[] {
  return [
    { index: 1, key: "create", label: "创建", status: resolveCreateStatus(taskStatus) },
    { index: 2, key: "collect", label: "采集", status: readStep(steps, "collect")?.status ?? "pending" },
    { index: 3, key: "tidy", label: "整理", status: readStep(steps, "tidy")?.status ?? "pending" },
    {
      index: 4,
      key: "approval",
      label: "选题",
      status: resolveSelectionStatus(taskStatus, steps),
    },
    { index: 5, key: "research", label: "调研", status: readStep(steps, "research")?.status ?? "pending" },
    { index: 6, key: "generate", label: "生成", status: resolveGenerateStatus(steps) },
    { index: 7, key: "publish", label: "发布", status: readStep(steps, "publish")?.status ?? "pending" },
  ];
}

function buildProgress(taskStatus: string): TaskProgressDto {
  const table: Array<{ match: string[]; percent: number; step: number; label: string }> = [
    { match: ["created"], percent: 5, step: 1, label: "创建" },
    { match: ["collecting"], percent: 10, step: 2, label: "采集" },
    { match: ["collected"], percent: 25, step: 3, label: "整理" },
    { match: ["awaiting_manager_selection", "approval_timeout"], percent: 35, step: 4, label: "选题" },
    { match: ["topics_selected", "manager_selected"], percent: 45, step: 5, label: "调研" },
    { match: ["generating_research"], percent: 50, step: 5, label: "调研" },
    { match: ["research_done"], percent: 60, step: 6, label: "生成" },
    { match: ["generating_copy"], percent: 65, step: 6, label: "生成" },
    { match: ["copy_generated"], percent: 72, step: 6, label: "生成" },
    { match: ["generating_image"], percent: 80, step: 6, label: "生成" },
    { match: ["image_generated"], percent: 90, step: 7, label: "发布" },
    { match: ["publishing"], percent: 95, step: 7, label: "发布" },
    { match: ["published"], percent: 100, step: 7, label: "发布" },
    { match: ["publish_partial_failed"], percent: 95, step: 7, label: "发布" },
    { match: ["failed", "cancelled", "aborted"], percent: 0, step: 0, label: "异常" },
  ];

  const row = table.find((r) => r.match.includes(taskStatus));
  if (row) return { percent: row.percent, current_step: row.step, label: row.label };
  return { percent: 0, current_step: 1, label: "未知" };
}

function buildStepSummary(taskStatus: string, steps: unknown): Record<string, StepStatus | "waiting_human"> {
  return {
    collect: readStep(steps, "collect")?.status ?? "pending",
    tidy: readStep(steps, "tidy")?.status ?? "pending",
    approval: resolveSelectionStatus(taskStatus, steps),
    research: readStep(steps, "research")?.status ?? "pending",
    copy: readStep(steps, "copy")?.status ?? "pending",
    image: readStep(steps, "image")?.status ?? "pending",
    publish: readStep(steps, "publish")?.status ?? "pending",
  };
}

export function extractDateYmdFromTask(taskId: string, createdAt?: string): string | null {
  const m = taskId.match(/^daily-(\d{8})-/);
  if (m?.[1]) return m[1];
  if (createdAt) {
    const d = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (d) return `${d[1]}${d[2]}${d[3]}`;
  }
  return null;
}

export function toTaskSummaryDto(task: JsonObject): TaskSummaryDto {
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "r01";
  const status = typeof task.status === "string" ? task.status : "unknown";
  const revision =
    typeof task.revision === "number" && Number.isInteger(task.revision) && task.revision >= 0
      ? task.revision
      : 0;
  const degraded = task.degraded === true;
  const createdAt = typeof task.created_at === "string" ? task.created_at : "";
  const updatedAt = typeof task.updated_at === "string" ? task.updated_at : createdAt;
  const steps = task.steps;

  const stepsDto: TaskSummaryDto["steps"] = {};
  for (const key of ["collect", "tidy", "approval", "approve", "research", "copy", "image", "publish"] as const) {
    const step = readStep(steps, key);
    if (step) stepsDto[key] = step;
  }

  let orchestratorMeta: TaskSummaryDto["orchestrator_meta"];
  if (isObject(task.orchestrator_meta)) {
    orchestratorMeta = {
      ...(typeof task.orchestrator_meta.last_event_id === "string"
        ? { last_event_id: task.orchestrator_meta.last_event_id }
        : {}),
      ...(typeof task.orchestrator_meta.last_dispatcher_id === "string"
        ? { last_dispatcher_id: task.orchestrator_meta.last_dispatcher_id }
        : {}),
      ...(typeof task.orchestrator_meta.last_dispatched_at === "string"
        ? { last_dispatched_at: task.orchestrator_meta.last_dispatched_at }
        : {}),
    };
  }

  return {
    task_id: taskId,
    run_id: runId,
    status,
    revision,
    degraded,
    created_at: createdAt,
    updated_at: updatedAt,
    steps: stepsDto,
    ui_steps: buildUiSteps(status, steps),
    ...(orchestratorMeta ? { orchestrator_meta: orchestratorMeta } : {}),
    progress: buildProgress(status),
    needs_human: status === "awaiting_manager_selection",
    is_terminal: isTerminalStatus(status),
  };
}

export function toDaySummaryDto(task: TaskSummaryDto, dateYmd: string): DaySummaryDto {
  return {
    date: formatIsoDateFromYmd(dateYmd),
    task_ids: [task.task_id],
    primary_task_id: task.task_id,
    status: task.status,
    step_summary: buildStepSummary(task.status, task.steps),
    updated_at: task.updated_at,
    is_terminal: task.is_terminal,
    needs_human: task.needs_human,
  };
}
