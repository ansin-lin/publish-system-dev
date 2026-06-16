import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { ensureTaskDirectories, loadTaskJson } from "../orchestrator/taskStore.js";
import { updateTask } from "../orchestrator/updateTask.js";
import { nowIsoJst, yyyymmddJst } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { runContentCopyRole } from "./copyRoleDispatch.js";
import { resolveCopyPlatformsForTask } from "../orchestrator/videoPlatforms.js";
import { loadTopicResearchFile, resolveTopicResearchPath } from "./topicResearch.js";

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

export type GenerateCopyParams = {
  taskJsonPath: string;
  operator?: string;
  settings?: OrchestratorSettings;
};

export type GenerateCopyResult = {
  copyPath: string;
  topicResearchPath: string;
  itemCount: number;
};

export async function generateCopy(params: GenerateCopyParams): Promise<GenerateCopyResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";

  const allowedStart = ["research_done", "manager_selected", "generating_copy", "copy_generated"];
  if (!allowedStart.includes(status)) {
    throw new Error(`generateCopy: task.status must be research_done|manager_selected|generating_copy (got ${status})`);
  }

  const existingCopy = stepField(task, "copy", "output_ref");
  if (status === "copy_generated" && existingCopy && fs.existsSync(existingCopy)) {
    return {
      copyPath: existingCopy,
      topicResearchPath: resolveTopicResearchPath(task),
      itemCount: 0,
    };
  }

  const operator = params.operator?.trim() || "orchestrator";
  const revertStatus = status === "manager_selected" ? "manager_selected" : "research_done";

  if (status === "research_done" || status === "manager_selected") {
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "copy_started",
        operator,
        changedFields: ["status", "steps.copy"],
        payload: {},
        mutate: (draft, context) => {
          draft.status = "generating_copy";
          mergeStep(draft, "copy", { status: "running", started_at: context.now, error: undefined, finished_at: undefined });
        },
      },
      settings,
    );
  } else if (status === "generating_copy") {
    const copySt = stepStatus(task, "copy");
    if (copySt === "running" || copySt === "failed") {
      await updateTask(
        {
          taskJsonPath: params.taskJsonPath,
          reason: "copy_retry",
          operator,
          changedFields: ["steps.copy"],
          payload: { previous_copy_status: copySt },
          mutate: (draft, context) => {
            mergeStep(draft, "copy", { status: "running", started_at: context.now, error: undefined, finished_at: undefined });
          },
        },
        settings,
      );
    }
  }

  const topicResearchPath = resolveTopicResearchPath(task);
  const artifact = loadTopicResearchFile(topicResearchPath);
  const taskId = typeof task.task_id === "string" ? task.task_id : artifact.task_id;
  const runId = typeof task.run_id === "string" ? task.run_id : artifact.run_id;

  const baseDir = ensureTaskDirectories(settings, taskId);
  const generateDir = path.resolve(baseDir, "generate");
  fs.mkdirSync(generateDir, { recursive: true });

  const { platforms: copyPlatforms, videoPick } = resolveCopyPlatformsForTask({ taskId, runId });

  try {
    const copyItems = [];
    for (const item of artifact.items) {
      const copyResult = await runContentCopyRole({
        item,
        task_id: taskId,
        run_id: runId,
        copy_platforms: copyPlatforms,
      });
      copyItems.push({
        topic_id: copyResult.topic_id,
        title: copyResult.title,
        source_platform: item.source_platform,
        writing_angle: copyResult.writing_angle,
        drafts: copyResult.drafts,
        image_prompts: copyResult.image_prompts,
      });
    }

    const datePart = yyyymmddJst();
    const outName = `copy_result_${datePart}_${runId}.json`;
    const copyPath = path.resolve(generateDir, outName);

    const copyArtifact: JsonObject = {
      schema_version: "copy_result.v1",
      generated_at: nowIsoJst(),
      task_id: taskId,
      run_id: runId,
      source_topic_research_ref: topicResearchPath,
      items: copyItems,
    };

    fs.writeFileSync(copyPath, JSON.stringify(copyArtifact, null, 2), "utf-8");

    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "copy_generated",
        operator,
        changedFields: ["status", "steps.copy"],
        payload: {
          copy_ref: copyPath,
          item_count: copyItems.length,
          copy_platforms: copyPlatforms,
          video_stock: videoPick ?
            { source: videoPick.source, asset_path: videoPick.path, pool_dir: videoPick.poolDir }
          : null,
        },
        mutate: (draft, context) => {
          draft.status = "copy_generated";
          mergeStep(draft, "copy", {
            status: "success",
            started_at: context.now,
            finished_at: context.now,
            input_ref: topicResearchPath,
            output_ref: copyPath,
            copy_platforms: copyPlatforms,
            ...(videoPick ?
              {
                video_pick: {
                  source: videoPick.source,
                  asset_path: videoPick.path,
                  pool_dir: videoPick.poolDir,
                },
              }
            : {}),
          });
        },
      },
      settings,
    );

    return { copyPath, topicResearchPath, itemCount: copyItems.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "copy_failed",
        operator,
        changedFields: ["status", "steps.copy"],
        payload: { error: message },
        mutate: (draft, context) => {
          draft.status = revertStatus;
          mergeStep(draft, "copy", {
            status: "failed",
            finished_at: context.now,
            input_ref: topicResearchPath,
            error: message,
          });
        },
      },
      settings,
    );
    throw error;
  }
}
