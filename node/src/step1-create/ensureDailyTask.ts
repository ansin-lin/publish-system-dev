import fs from "node:fs";
import { createTask } from "./createTask.js";
import { taskJsonPath } from "../orchestrator/taskStore.js";
import { yyyymmddJst, jstHour } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import type { PublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";

export type EnsureDailyTaskResult = {
  run_id?: string;
  action: "created" | "skipped_exists" | "not_due" | "disabled" | "unsupported_format" | "failed";
  taskId?: string;
  reason?: string;
  error?: string;
};

export type EnsureDailyTasksResult = {
  runs: EnsureDailyTaskResult[];
};

type EnsureRunSpec = {
  run_id: string;
  start_hour: number;
  end_hour: number;
  legacyGrace?: boolean;
};

function buildDailyTaskId(settings: OrchestratorSettings, runId: string): string | null {
  const step1 = settings.publishConfig.step1;
  if (step1.task_id_date_format !== "daily-YYYYMMDD") return null;
  return `daily-${yyyymmddJst()}-${runId}`;
}

function isWithinLegacyGraceWindow(notBeforeHour: number, graceHours: number, hour: number): boolean {
  if (graceHours <= 0) return hour >= notBeforeHour;
  const endHour = (notBeforeHour + graceHours) % 24;
  if (notBeforeHour + graceHours < 24) {
    return hour >= notBeforeHour && hour < notBeforeHour + graceHours;
  }
  return hour >= notBeforeHour || hour < endHour;
}

function isWithinHourWindow(startHour: number, endHour: number, hour: number): boolean {
  return hour >= startHour && hour < endHour;
}

function resolveEnsureRunSpecs(step1: PublishOrchestratorConfig["step1"]): EnsureRunSpec[] {
  const cfg = step1.ensure_daily;
  if (cfg.runs.length > 0) {
    return cfg.runs.map((run) => ({
      run_id: run.run_id,
      start_hour: run.start_hour,
      end_hour: run.end_hour,
    }));
  }
  return [
    {
      run_id: step1.default_run_id,
      start_hour: cfg.not_before_hour,
      end_hour: cfg.not_before_hour,
      legacyGrace: true,
    },
  ];
}

async function ensureDailyTaskForRun(
  settings: OrchestratorSettings,
  spec: EnsureRunSpec,
): Promise<EnsureDailyTaskResult> {
  const cfg = settings.publishConfig.step1.ensure_daily;
  const taskId = buildDailyTaskId(settings, spec.run_id);
  if (!taskId) {
    return {
      run_id: spec.run_id,
      action: "unsupported_format",
      reason: settings.publishConfig.step1.task_id_date_format,
    };
  }

  const hour = jstHour();
  const inWindow = spec.legacyGrace
    ? isWithinLegacyGraceWindow(cfg.not_before_hour, cfg.grace_hours, hour)
    : isWithinHourWindow(spec.start_hour, spec.end_hour, hour);
  if (!inWindow) {
    return {
      run_id: spec.run_id,
      action: "not_due",
      taskId,
      reason: `jst_hour=${hour}`,
    };
  }

  const tpath = taskJsonPath(settings, taskId);
  if (fs.existsSync(tpath)) {
    return { run_id: spec.run_id, action: "skipped_exists", taskId };
  }

  try {
    await createTask({
      taskId,
      runId: spec.run_id,
      trigger: "run_once_ensure",
      settings,
    });
    return { run_id: spec.run_id, action: "created", taskId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { run_id: spec.run_id, action: "failed", taskId, error: message };
  }
}

export async function ensureDailyTasks(
  settings: OrchestratorSettings,
): Promise<EnsureDailyTasksResult> {
  const cfg = settings.publishConfig.step1.ensure_daily;
  if (!cfg?.enabled) {
    return { runs: [{ action: "disabled" }] };
  }

  const specs = resolveEnsureRunSpecs(settings.publishConfig.step1);
  const runs: EnsureDailyTaskResult[] = [];
  for (const spec of specs) {
    runs.push(await ensureDailyTaskForRun(settings, spec));
  }
  return { runs };
}

/** @deprecated Prefer `ensureDailyTasks` for multi-run schedules. */
export async function ensureDailyTask(
  settings: OrchestratorSettings,
): Promise<EnsureDailyTaskResult> {
  const result = await ensureDailyTasks(settings);
  return result.runs[0] ?? { action: "disabled" };
}
