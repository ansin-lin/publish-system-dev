import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import type { TaskJson } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stepStatus(task: TaskJson, stepName: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const status = step.status;
  return typeof status === "string" ? status : "";
}

export function stepField(task: TaskJson, stepName: string, field: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const v = step[field];
  return typeof v === "string" ? v : "";
}

export function resolveTopicResearchRef(task: TaskJson): string {
  return stepField(task, "research", "output_ref") || stepField(task, "approve", "research_ref");
}

/** Step6 requires successful Step5 artifact on disk. */
export function hasTopicResearchReady(task: TaskJson): boolean {
  if (stepStatus(task, "research") !== "success") return false;
  const ref = resolveTopicResearchRef(task);
  return Boolean(ref && ref.includes("topic_research") && fs.existsSync(ref));
}
