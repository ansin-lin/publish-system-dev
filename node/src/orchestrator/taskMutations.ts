import type { JsonObject } from "../step2-collect/types.js";
import type { TaskJson } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function ensureStep(task: TaskJson, stepName: string): JsonObject {
  if (!isObject(task.steps)) task.steps = {};
  const steps = task.steps;
  if (!isObject(steps)) throw new Error("task.steps must be an object");
  const current = steps[stepName];
  if (isObject(current)) return current;
  const next: JsonObject = { status: "pending" };
  steps[stepName] = next;
  return next;
}

export function mergeStep(task: TaskJson, stepName: string, patch: JsonObject): void {
  const step = ensureStep(task, stepName);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete step[key];
    else step[key] = value;
  }
}
