import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import { updateTask } from "../orchestrator/updateTask.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { assertAwaitingPublishReview, isPublishReviewEnabled } from "./copyReviewGuards.js";

export type PublishReviewAction = "approve" | "reject";

export type ApplyPublishReviewParams = {
  taskJsonPath: string;
  action: PublishReviewAction;
  operator?: string;
  settings?: OrchestratorSettings;
};

export type ApplyPublishReviewResult = {
  task_id: string;
  action: PublishReviewAction;
  task_status: string;
};

export async function applyPublishReview(params: ApplyPublishReviewParams): Promise<ApplyPublishReviewResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const config = loadPublishOrchestratorConfig();
  if (!isPublishReviewEnabled(config)) {
    throw new Error("step6.publish_review.enabled is false");
  }

  const task = loadTaskJson(params.taskJsonPath);
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const operator = params.operator?.trim() || "dashboard";

  if (params.action === "approve") {
    assertAwaitingPublishReview(task);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "publish_review_approved",
        operator,
        changedFields: ["status", "steps.copy_review"],
        payload: { action: "approve" },
        mutate: (draft, context) => {
          draft.status = "image_generated";
          mergeStep(draft, "copy_review", {
            status: "success",
            finished_at: context.now,
            operator,
          });
        },
      },
      settings,
    );
    return { task_id: taskId, action: "approve", task_status: "image_generated" };
  }

  if (params.action === "reject") {
    assertAwaitingPublishReview(task);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "publish_review_rejected",
        operator,
        changedFields: ["status", "steps.copy_review"],
        payload: { action: "reject" },
        mutate: (draft, context) => {
          draft.status = "cancelled";
          mergeStep(draft, "copy_review", {
            status: "failed",
            finished_at: context.now,
            operator,
            error: "rejected by operator",
          });
        },
      },
      settings,
    );
    return { task_id: taskId, action: "reject", task_status: "cancelled" };
  }

  throw new Error(`unknown action: ${params.action as string}`);
}
