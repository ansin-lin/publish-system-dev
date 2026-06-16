import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import { updateTask } from "../orchestrator/updateTask.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepField(task: JsonObject, stepName: string, field: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const v = step[field];
  return typeof v === "string" ? v : "";
}

function stepStatus(task: JsonObject, stepName: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  return typeof step.status === "string" ? step.status : "";
}

export type RetryStep7Params = {
  taskJsonPath: string;
  operator?: string;
  settings?: OrchestratorSettings;
};

/**
 * Reset Step7 (`publish`) after a failure so the task can be published again.
 *
 * - task.status is moved back to `image_generated`
 * - steps.publish is reset to `pending` and previous errors/results are cleared
 *
 * This is intentionally manual: it does not run Playwright.
 */
export async function retryStep7(params: RetryStep7Params): Promise<{ ok: true; taskStatus: string }> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const operator = params.operator?.trim() || "cli:local";
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";

  const allowedFrom = new Set(["failed", "publish_partial_failed", "publishing", "image_generated"]);
  if (!allowedFrom.has(status)) {
    throw new Error(`retry-step7: task.status must be failed|publish_partial_failed|publishing|image_generated (got ${status})`);
  }

  const copyRef = stepField(task, "copy", "output_ref");
  const imageRef = stepField(task, "image", "output_ref");
  if (!copyRef || !fs.existsSync(copyRef)) throw new Error(`retry-step7: missing steps.copy.output_ref (${copyRef})`);
  if (!imageRef || !fs.existsSync(imageRef)) throw new Error(`retry-step7: missing steps.image.output_ref (${imageRef})`);
  if (stepStatus(task, "image") !== "success") throw new Error("retry-step7: steps.image must be success before Step7 retry");

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: "step7_retry_reset",
      operator,
      changedFields: ["status", "steps.publish"],
      payload: { from_status: status, to_status: "image_generated" },
      mutate: (draft, context) => {
        draft.status = "image_generated";
        mergeStep(draft, "publish", {
          status: "pending",
          started_at: undefined,
          finished_at: undefined,
          input_ref: undefined,
          output_ref: undefined,
          job_ref: undefined,
          platforms: undefined,
          platform_results: undefined,
          summary: undefined,
          error: undefined,
          reset_at: context.now,
          reset_by: operator,
        });
      },
    },
    settings,
  );

  return { ok: true, taskStatus: "image_generated" };
}

