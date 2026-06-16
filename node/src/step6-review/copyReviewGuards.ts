import type { JsonObject } from "../step2-collect/types.js";
import type { PublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import type { TaskJson } from "../orchestrator/types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepRecord(task: TaskJson, stepName: string): JsonObject | null {
  const steps = task.steps;
  if (!isObject(steps)) return null;
  const step = steps[stepName];
  return isObject(step) ? step : null;
}

export function isPublishReviewEnabled(config: PublishOrchestratorConfig): boolean {
  return config.step6.publish_review.enabled;
}

export function hasCopyReviewStep(task: TaskJson): boolean {
  return stepRecord(task, "copy_review") !== null;
}

export function copyReviewStatus(task: TaskJson): string {
  const step = stepRecord(task, "copy_review");
  return step && typeof step.status === "string" ? step.status : "";
}

export function copyRevisionCount(task: TaskJson): number {
  const step = stepRecord(task, "copy");
  if (!step) return 0;
  const n = step.revision_count;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Grandfather: image_generated tasks created before copy_review existed may publish without approval. */
export function copyReviewRequiredForPublish(
  task: TaskJson,
  config: PublishOrchestratorConfig,
  taskStatus: string,
): boolean {
  if (!isPublishReviewEnabled(config)) return false;
  if (taskStatus === "publish_partial_failed") return false;
  if (taskStatus === "publishing") return false;
  if (taskStatus === "image_generated" && !hasCopyReviewStep(task)) return false;
  if (taskStatus === "awaiting_publish_review") return true;
  if (taskStatus === "image_generated") return copyReviewStatus(task) !== "success";
  return false;
}

export function copyReviewBlocksPublish(
  task: TaskJson,
  config: PublishOrchestratorConfig,
  taskStatus: string,
): boolean {
  return copyReviewRequiredForPublish(task, config, taskStatus);
}

export function assertAwaitingPublishReview(task: TaskJson): void {
  const status = typeof task.status === "string" ? task.status : "";
  if (status !== "awaiting_publish_review") {
    throw new Error(`task.status must be awaiting_publish_review (got ${status})`);
  }
}

export function canRegenerateCopy(task: TaskJson, config: PublishOrchestratorConfig): {
  ok: boolean;
  reason?: string;
} {
  const status = typeof task.status === "string" ? task.status : "";
  if (status !== "awaiting_publish_review") {
    return { ok: false, reason: `status must be awaiting_publish_review (got ${status})` };
  }
  if (stepRecord(task, "copy_review") && copyReviewStatus(task) === "running") {
    return { ok: false, reason: "copy_review is already running" };
  }
  const max = config.step6.publish_review.max_revisions;
  const count = copyRevisionCount(task);
  if (count >= max) {
    return { ok: false, reason: `max_revisions reached (${count}/${max})` };
  }
  return { ok: true };
}
