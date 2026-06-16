import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import { updateTask } from "../orchestrator/updateTask.js";
import { nowIsoJst } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import type { CopyDraft } from "../step6-generate/copyRoleDispatch.js";
import { isCopyConstraintViolationError } from "../step6-generate/copyRoleDispatch.js";
import { runContentCopyRegenerateRole } from "../step6-generate/copyRoleDispatch.js";
import { loadTopicResearchFile, resolveTopicResearchPath } from "../step6-generate/topicResearch.js";
import { assertAwaitingPublishReview, canRegenerateCopy } from "./copyReviewGuards.js";
import { loadCopyResultFile, mergeCopyResultDrafts } from "./mergeCopyResult.js";

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

function normalizePlatform(raw: string): string {
  return raw.trim().toLowerCase();
}

function loadExistingDrafts(copyPath: string): CopyDraft[] {
  const doc = loadCopyResultFile(copyPath);
  const items = Array.isArray(doc.items) ? doc.items : [];
  const out: CopyDraft[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    const drafts = Array.isArray(item.drafts) ? item.drafts : [];
    for (const d of drafts) {
      if (!isObject(d)) continue;
      const platform = typeof d.platform === "string" ? d.platform.trim() : "";
      const body = typeof d.body === "string" ? d.body.trim() : "";
      if (!platform || !body) continue;
      out.push({
        platform,
        locale: typeof d.locale === "string" ? d.locale : "",
        title: typeof d.title === "string" ? d.title : "",
        body,
        tags: Array.isArray(d.tags) ?
          d.tags.filter((t): t is string => typeof t === "string")
        : [],
      });
    }
  }
  return out;
}

export type RegenerateCopyPlatformsParams = {
  taskJsonPath: string;
  platforms: string[];
  feedback: string;
  operator?: string;
  settings?: OrchestratorSettings;
};

export type RegenerateCopyPlatformsResult = {
  task_id: string;
  merged_platforms: string[];
  copy_path: string;
  revision_count: number;
};

export async function regenerateCopyPlatforms(
  params: RegenerateCopyPlatformsParams,
): Promise<RegenerateCopyPlatformsResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const config = loadPublishOrchestratorConfig();
  const operator = params.operator?.trim() || "dashboard";

  const platforms = [...new Set(params.platforms.map((p) => normalizePlatform(p)).filter(Boolean))];
  const feedback = params.feedback.trim();
  if (!platforms.length) throw new Error("platforms must not be empty");
  if (!feedback) throw new Error("feedback is required");

  let task = loadTaskJson(params.taskJsonPath);
  assertAwaitingPublishReview(task);
  const regenCheck = canRegenerateCopy(task, config);
  if (!regenCheck.ok) throw new Error(regenCheck.reason ?? "cannot regenerate");

  const copyPath = stepField(task, "copy", "output_ref");
  if (!copyPath || !fs.existsSync(copyPath)) {
    throw new Error(`missing steps.copy.output_ref (${copyPath})`);
  }

  const topicResearchPath = resolveTopicResearchPath(task);
  const researchArtifact = loadTopicResearchFile(topicResearchPath);
  const taskId = typeof task.task_id === "string" ? task.task_id : researchArtifact.task_id;
  const runId = typeof task.run_id === "string" ? task.run_id : researchArtifact.run_id;

  if (!researchArtifact.items.length) throw new Error("topic_research has no items");

  const existingDrafts = loadExistingDrafts(copyPath);
  const revisionAtStart =
    task.steps && isObject(task.steps) && isObject(task.steps.copy) &&
    typeof task.steps.copy.revision_count === "number" ?
      task.steps.copy.revision_count
    : 0;

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: "copy_regenerate_started",
      operator,
      changedFields: ["status", "steps.copy_review"],
      payload: { platforms, feedback_preview: feedback.slice(0, 200) },
      mutate: (draft, context) => {
        draft.status = "revising_copy";
        mergeStep(draft, "copy_review", { status: "running", started_at: context.now, operator });
      },
    },
    settings,
  );

  try {
    const item = researchArtifact.items[0]!;
    const newDrafts: CopyDraft[] = [];
    for (const platform of platforms) {
      const regenerated = await runContentCopyRegenerateRole({
        item,
        task_id: taskId,
        run_id: runId,
        target_platform: platform,
        feedback,
        existing_drafts: existingDrafts,
      });
      newDrafts.push(...regenerated.drafts);
    }

    const merged = mergeCopyResultDrafts({ copyPath, newDrafts, operator });
    const revisionCount = revisionAtStart + 1;

    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "copy_regenerate_done",
        operator,
        changedFields: ["status", "steps.copy", "steps.copy_review"],
        payload: { platforms: merged.mergedPlatforms, revision_count: revisionCount },
        mutate: (draft, context) => {
          draft.status = "awaiting_publish_review";
          const stepsObj = draft.steps;
          const copyStep =
            stepsObj && isObject(stepsObj) && isObject(stepsObj.copy) ? stepsObj.copy : null;
          const revisions =
            copyStep && Array.isArray(copyStep.revisions) ? [...copyStep.revisions] : [];
          revisions.push({
            at: context.now,
            operator,
            platforms: merged.mergedPlatforms,
            feedback,
          });
          mergeStep(draft, "copy", {
            revision_count: revisionCount,
            revisions: revisions.slice(-20),
            last_regenerated_at: context.now,
          });
          mergeStep(draft, "copy_review", {
            status: "pending",
            finished_at: context.now,
            operator,
            last_error: undefined,
            last_error_kind: undefined,
            error: undefined,
          });
        },
      },
      settings,
    );

    return {
      task_id: taskId,
      merged_platforms: merged.mergedPlatforms,
      copy_path: merged.copyPath,
      revision_count: revisionCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const constraintOnly = isCopyConstraintViolationError(message);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: constraintOnly ? "copy_regenerate_constraint_failed" : "copy_regenerate_failed",
        operator,
        changedFields: ["status", "steps.copy_review", "steps.copy"],
        payload: { error: message, revision_count_preserved: revisionAtStart, constraint_only: constraintOnly },
        mutate: (draft, context) => {
          draft.status = "awaiting_publish_review";
          const copyStep = draft.steps && isObject(draft.steps) && isObject(draft.steps.copy) ? draft.steps.copy : null;
          const failedAttempts =
            copyStep && typeof copyStep.failed_regenerate_attempts === "number" ?
              copyStep.failed_regenerate_attempts + 1
            : 1;
          mergeStep(draft, "copy", {
            revision_count: revisionAtStart,
            failed_regenerate_attempts: failedAttempts,
            last_regenerate_error: message,
            last_regenerate_error_at: context.now,
          });
          mergeStep(draft, "copy_review", {
            status: "pending",
            finished_at: context.now,
            operator,
            last_error: message,
            ...(constraintOnly ? { last_error_kind: "constraint" } : { last_error_kind: "other" }),
          });
        },
      },
      settings,
    );
    throw error;
  }
}
