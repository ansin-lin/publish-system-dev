import fs from "node:fs";
import path from "node:path";
import { nowIsoJst, yyyymmddHhmmssJst, yyyymmddJst } from "./time.js";
import type { CollectResult, JsonObject, PathSettings } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function loadTask(taskJsonPath: string): JsonObject {
  const data = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as unknown;
  if (!isObject(data)) throw new Error("task.json must be a JSON object");
  return data;
}

export function saveTask(taskJsonPath: string, task: JsonObject): void {
  fs.writeFileSync(taskJsonPath, JSON.stringify(task, null, 2), "utf-8");
}

export function ensureStep(task: JsonObject, stepName: string): JsonObject {
  if (!isObject(task.steps)) task.steps = {};
  const steps = task.steps;
  if (!isObject(steps)) throw new Error("task.steps must be an object");
  const step = steps[stepName];
  if (isObject(step)) return step;
  const next: JsonObject = { status: "pending" };
  steps[stepName] = next;
  return next;
}

export function appendHistory(task: JsonObject, event: string, operator = "system", data: JsonObject = {}): void {
  if (task.history === undefined) task.history = [];
  if (!Array.isArray(task.history)) throw new Error("task.history must be an array");
  task.history.push({
    at: nowIsoJst(),
    event,
    operator,
    data,
  });
}

export function touchUpdatedAt(task: JsonObject): void {
  task.updated_at = nowIsoJst();
}

export function taskDir(paths: PathSettings, taskId: string): string {
  const tid = taskId.trim();
  if (!tid) throw new Error("task_id must be non-empty");
  return path.resolve(paths.tasksDir, tid);
}

export function collectResultPath(paths: PathSettings, taskId: string, runId: string): string {
  const suffix = runId.trim() ? `_${runId.trim()}` : "";
  return path.resolve(taskDir(paths, taskId), "collect", `collect_result_${yyyymmddJst()}${suffix}.json`);
}

export function buildStepLogPath(paths: PathSettings, step: string, taskId: string): string {
  return path.resolve(paths.logsDir, "collector", `${step}_${taskId}_${yyyymmddHhmmssJst()}.log`);
}

export function writeCollectResult(outputPath: string, result: CollectResult): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");
}

export function updateCollectStep(task: JsonObject, outputPath: string, result: CollectResult): boolean {
  const step = ensureStep(task, "collect");
  step.output_ref = outputPath;
  delete step.output_ref_for_analyze;
  step.finished_at = result.generated_at;

  const ok = result.ok === true && result.items.length > 0;
  if (ok && result.errors.length === 0) {
    step.status = "success";
  } else if (ok) {
    step.status = "partial_failed";
    task.degraded = true;
  } else {
    step.status = "failed";
    step.error = {
      code: "NO_VALID_ITEMS",
      message: "collect_result has no items",
      retryable: false,
    };
  }

  touchUpdatedAt(task);
  appendHistory(task, "collect_finished", "system", { output_ref: outputPath, ok });
  return ok;
}
