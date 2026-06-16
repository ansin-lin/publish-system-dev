import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "./config.js";
import { mergeStep } from "./taskMutations.js";
import {
  getMaxStaleRollbacksPerStepPerDay,
  getStaleExcludedStatuses,
  getStaleThresholdMs,
} from "./publishOrchestratorConfig.js";
import { getString, isTerminalStatus, listTaskJsonPaths, loadTaskJson } from "./taskStore.js";
import { ageMsSinceIsoJst } from "./time.js";
import { updateTask } from "./updateTask.js";
import type { OrchestratorSettings, TaskJson } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepRecord(task: TaskJson, stepName: string): JsonObject | null {
  const steps = task.steps;
  if (!isObject(steps)) return null;
  const step = steps[stepName];
  return isObject(step) ? step : null;
}

function stepStatus(task: TaskJson, stepName: string): string {
  const step = stepRecord(task, stepName);
  return step && typeof step.status === "string" ? step.status : "";
}

function stepStartedAt(task: TaskJson, stepName: string): string {
  const step = stepRecord(task, stepName);
  return step && typeof step.started_at === "string" ? step.started_at : "";
}

export type StaleRollbackPlan = {
  stepName: string;
  startedAt: string;
  ageMs: number;
  thresholdMs: number;
  fromStatus: string;
  toStatus: string;
  reason: string;
};

type StaleRule = {
  stepName: string;
  when: (task: TaskJson, taskStatus: string) => boolean;
  plan: (taskStatus: string) => Omit<StaleRollbackPlan, "stepName" | "startedAt" | "ageMs" | "thresholdMs">;
  skip?: (task: TaskJson) => boolean;
};

const STALE_RULES: StaleRule[] = [
  {
    stepName: "collect",
    when: (task, status) => status === "collecting" && stepStatus(task, "collect") === "running",
    plan: () => ({
      fromStatus: "collecting",
      toStatus: "collecting",
      reason: "stale_collect_running",
    }),
  },
  {
    stepName: "tidy",
    when: (task, status) => status === "collected" && stepStatus(task, "tidy") === "running",
    plan: () => ({
      fromStatus: "collected",
      toStatus: "collected",
      reason: "stale_tidy_running",
    }),
  },
  {
    stepName: "research",
    when: (task, status) =>
      (status === "generating_research" || status === "topics_selected") && stepStatus(task, "research") === "running",
    plan: (status) => ({
      fromStatus: status,
      toStatus: "topics_selected",
      reason: "stale_research_running",
    }),
  },
  {
    stepName: "copy",
    when: (task, status) => status === "generating_copy" && stepStatus(task, "copy") === "running",
    plan: () => ({
      fromStatus: "generating_copy",
      toStatus: "research_done",
      reason: "stale_copy_running",
    }),
  },
  {
    stepName: "image",
    when: (task, status) =>
      (status === "generating_image" || status === "copy_generated") && stepStatus(task, "image") === "running",
    plan: (status) => ({
      fromStatus: status === "copy_generated" ? "copy_generated" : "generating_image",
      toStatus: "copy_generated",
      reason: "stale_image_running",
    }),
  },
  {
    stepName: "publish",
    when: (task, status) => status === "publishing" && stepStatus(task, "publish") === "running",
    plan: () => ({
      fromStatus: "publishing",
      toStatus: "image_generated",
      reason: "stale_publish_running",
    }),
    skip: (task) => {
      const step = stepRecord(task, "publish");
      if (!step) return true;
      const out = typeof step.output_ref === "string" ? step.output_ref : "";
      if (out.trim()) return true;
      const results = step.platform_results;
      if (Array.isArray(results) && results.length > 0) return true;
      return false;
    },
  },
];

function thresholdForStep(stepName: string, overrides?: Record<string, number>): number {
  if (overrides?.[stepName]) return overrides[stepName]!;
  return getStaleThresholdMs(stepName);
}

function ensureOrchestratorMeta(task: TaskJson): JsonObject {
  const current = task.orchestrator_meta;
  if (isObject(current)) return current;
  const next: JsonObject = {};
  task.orchestrator_meta = next;
  return next;
}

function staleRollbackHistory(meta: JsonObject): JsonObject[] {
  const raw = meta.stale_rollbacks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject);
}

function rollbackCountLast24h(meta: JsonObject, stepName: string, nowMs: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return staleRollbackHistory(meta).filter((row) => {
    if (row.step !== stepName) return false;
    const at = typeof row.at === "string" ? row.at : "";
    const age = ageMsSinceIsoJst(at, nowMs);
    return age !== null && age <= dayMs;
  }).length;
}

export function detectStaleRollbackPlan(
  task: TaskJson,
  params: { nowMs?: number; thresholdOverrides?: Record<string, number> } = {},
): StaleRollbackPlan | null {
  const taskStatus = typeof task.status === "string" ? task.status : "";
  if (!taskStatus || getStaleExcludedStatuses().has(taskStatus) || isTerminalStatus(taskStatus)) {
    return null;
  }

  const nowMs = params.nowMs ?? Date.now();

  for (const rule of STALE_RULES) {
    if (!rule.when(task, taskStatus)) continue;
    if (rule.skip?.(task)) continue;

    const startedAt = stepStartedAt(task, rule.stepName);
    const ageMs = startedAt ? ageMsSinceIsoJst(startedAt, nowMs) : null;
    const thresholdMs = thresholdForStep(rule.stepName, params.thresholdOverrides);

    if (ageMs === null || ageMs >= thresholdMs) {
      const base = rule.plan(taskStatus);
      return {
        stepName: rule.stepName,
        startedAt: startedAt || "(missing)",
        ageMs: ageMs ?? Number.POSITIVE_INFINITY,
        thresholdMs,
        fromStatus: base.fromStatus,
        toStatus: base.toStatus,
        reason: base.reason,
      };
    }
  }

  return null;
}

export type ReconcileStaleStepsResult = {
  scanned: number;
  staleDetected: number;
  rolledBack: number;
  skippedCap: number;
  dryRun: boolean;
  actions: Array<{ task_id: string; plan: StaleRollbackPlan; applied: boolean; skip_reason?: string }>;
};

async function applyStaleRollback(
  taskJsonPath: string,
  plan: StaleRollbackPlan,
  settings: OrchestratorSettings,
): Promise<void> {
  await updateTask(
    {
      taskJsonPath,
      reason: "stale_step_rollback",
      operator: "orchestrator:stale-watchdog",
      changedFields: ["status", `steps.${plan.stepName}`, "orchestrator_meta"],
      payload: {
        step: plan.stepName,
        from_status: plan.fromStatus,
        to_status: plan.toStatus,
        started_at: plan.startedAt,
        age_ms: plan.ageMs,
        threshold_ms: plan.thresholdMs,
        rollback_reason: plan.reason,
      },
      mutate: (draft, context) => {
        if (plan.fromStatus !== plan.toStatus) {
          draft.status = plan.toStatus;
        }
        mergeStep(draft, plan.stepName, {
          status: "failed",
          finished_at: context.now,
          error: `stale_timeout: step ran longer than ${plan.thresholdMs}ms`,
          stale_rollback_at: context.now,
        });
        const meta = ensureOrchestratorMeta(draft);
        const history = staleRollbackHistory(meta);
        history.push({
          at: context.now,
          step: plan.stepName,
          from_status: plan.fromStatus,
          to_status: plan.toStatus,
          reason: plan.reason,
        });
        meta.stale_rollbacks = history.slice(-50);
      },
    },
    settings,
  );
}

export async function reconcileStaleSteps(
  params: {
    settings?: OrchestratorSettings;
    dryRun?: boolean;
    thresholdOverrides?: Record<string, number>;
    taskJsonPath?: string;
  } = {},
): Promise<ReconcileStaleStepsResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const dryRun = params.dryRun === true;
  const nowMs = Date.now();
  const paths =
    params.taskJsonPath ? [params.taskJsonPath] : listTaskJsonPaths(settings);

  const result: ReconcileStaleStepsResult = {
    scanned: 0,
    staleDetected: 0,
    rolledBack: 0,
    skippedCap: 0,
    dryRun,
    actions: [],
  };

  for (const tpath of paths) {
    const task = loadTaskJson(tpath);
    result.scanned += 1;

    const plan = detectStaleRollbackPlan(task, {
      nowMs,
      ...(params.thresholdOverrides ? { thresholdOverrides: params.thresholdOverrides } : {}),
    });
    if (!plan) continue;

    result.staleDetected += 1;
    let taskId = "";
    try {
      taskId = getString(task, "task_id");
    } catch {
      taskId = tpath;
    }

    const meta = isObject(task.orchestrator_meta) ? task.orchestrator_meta : {};
    if (rollbackCountLast24h(meta, plan.stepName, nowMs) >= getMaxStaleRollbacksPerStepPerDay()) {
      result.skippedCap += 1;
      result.actions.push({
        task_id: taskId,
        plan,
        applied: false,
        skip_reason: "max_rollbacks_per_step_per_day",
      });
      continue;
    }

    if (dryRun) {
      result.actions.push({ task_id: taskId, plan, applied: false });
      continue;
    }

    await applyStaleRollback(tpath, plan, settings);
    result.rolledBack += 1;
    result.actions.push({ task_id: taskId, plan, applied: true });
  }

  return result;
}
