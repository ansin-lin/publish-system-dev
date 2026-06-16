import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { generateCopy } from "./generateCopy.js";
import { generateImages } from "./generateImages.js";

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

export type ExecuteStep6Params = {
  taskJsonPath: string;
  operator?: string;
  settings?: OrchestratorSettings;
};

export type ExecuteStep6Result = {
  copyPath: string;
  imagePath: string;
  copyItemCount: number;
  imageCount: number;
};

/**
 * Step6: topic_research → content-copy → copy_result → content-image (merged prompts) → image_result
 */
export async function executeStep6(params: ExecuteStep6Params): Promise<ExecuteStep6Result> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";

  const imageRef = stepField(task, "image", "output_ref");
  if (status === "image_generated" && imageRef && fs.existsSync(imageRef)) {
    return {
      copyPath: stepField(task, "copy", "output_ref"),
      imagePath: imageRef,
      copyItemCount: 0,
      imageCount: 0,
    };
  }

  let copyPath = stepField(task, "copy", "output_ref");
  let copyItemCount = 0;

  if (
    status === "research_done" ||
    status === "manager_selected" ||
    status === "generating_copy" ||
    !copyPath ||
    !fs.existsSync(copyPath)
  ) {
    const copyParams: Parameters<typeof generateCopy>[0] = {
      taskJsonPath: params.taskJsonPath,
      settings,
    };
    if (params.operator) copyParams.operator = params.operator;
    const copy = await generateCopy(copyParams);
    copyPath = copy.copyPath;
    copyItemCount = copy.itemCount;
  }

  const imageParams: Parameters<typeof generateImages>[0] = {
    taskJsonPath: params.taskJsonPath,
    settings,
  };
  if (params.operator) imageParams.operator = params.operator;
  const images = await generateImages(imageParams);

  return {
    copyPath,
    imagePath: images.imagePath,
    copyItemCount,
    imageCount: images.imageCount,
  };
}
