import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { ensureTaskDirectories, loadTaskJson } from "../orchestrator/taskStore.js";
import { notifyStepCompletedForTask } from "../orchestrator/stepCompletionSlack.js";
import { formatStep6NotifyDetail } from "../orchestrator/stepNotifyDetail.js";
import { updateTask } from "../orchestrator/updateTask.js";
import { nowIsoJst, yyyymmddJst } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import type { CopyImagePrompt } from "./copyRoleDispatch.js";
import type { GeneratedImageRecord } from "./imageRecords.js";
import { generateTopicImages } from "./imageDelivery.js";
import { mergeImagePromptSlots } from "./mergeImagePrompts.js";
import type { MergedImageSlot } from "./mergeImagePrompts.js";
import { pickStockImages, type StockImagePickResult } from "./stockImagePool.js";
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

function loadCopyResult(copyPath: string): {
  items: Array<{
    topic_id: string;
    title: string;
    image_prompts: CopyImagePrompt[];
  }>;
} {
  const raw = JSON.parse(fs.readFileSync(copyPath, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("copy_result must be a JSON object");
  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    throw new Error("copy_result.items is empty");
  }
  const items: Array<{ topic_id: string; title: string; image_prompts: CopyImagePrompt[] }> = [];
  for (const row of itemsRaw) {
    if (!isObject(row)) continue;
    const topic_id = typeof row.topic_id === "string" ? row.topic_id : "";
    const title = typeof row.title === "string" ? row.title : "";
    const promptsRaw = row.image_prompts;
    if (!topic_id || !Array.isArray(promptsRaw)) continue;
    const image_prompts: CopyImagePrompt[] = [];
    for (let i = 0; i < promptsRaw.length; i += 1) {
      const p = promptsRaw[i];
      if (!isObject(p)) continue;
      const prompt = typeof p.prompt === "string" ? p.prompt.trim() : "";
      if (!prompt) continue;
      const slot_id = typeof p.slot_id === "string" && p.slot_id.trim() ? p.slot_id.trim() : `img_${i + 1}`;
      const entry: CopyImagePrompt = { slot_id, prompt };
      if (typeof p.style === "string" && p.style.trim()) entry.style = p.style.trim();
      if (typeof p.aspect_ratio === "string" && p.aspect_ratio.trim()) entry.aspect_ratio = p.aspect_ratio.trim();
      image_prompts.push(entry);
    }
    items.push({ topic_id, title, image_prompts });
  }
  if (!items.length) throw new Error("copy_result has no valid items");
  return { items };
}

function buildRecordsFromStock(
  slots: MergedImageSlot[],
  pick: StockImagePickResult,
): GeneratedImageRecord[] {
  const records: GeneratedImageRecord[] = [];
  const count = Math.min(pick.paths.length, slots.length);
  for (let i = 0; i < count; i += 1) {
    const slot = slots[i]!;
    const asset_path = pick.paths[i]!;
    records.push({
      slot_id: slot.slot_id,
      prompt: slot.merged_prompt,
      research_image_hint: slot.research_image_hint,
      copy_image_prompt: slot.copy_image_prompt,
      mode: pick.source,
      asset_path,
      status: "success",
      ...(slot.style ? { style: slot.style } : {}),
      ...(slot.aspect_ratio ? { aspect_ratio: slot.aspect_ratio } : {}),
    });
  }
  return records;
}

export type GenerateImagesParams = {
  taskJsonPath: string;
  operator?: string;
  settings?: OrchestratorSettings;
};

export type GenerateImagesResult = {
  imagePath: string;
  copyPath: string;
  topicResearchPath: string;
  imageCount: number;
};

export async function generateImages(params: GenerateImagesParams): Promise<GenerateImagesResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";

  if (status !== "copy_generated" && status !== "generating_image" && status !== "image_generated") {
    throw new Error(`generateImages: task.status must be copy_generated|generating_image (got ${status})`);
  }

  const existingImage = stepField(task, "image", "output_ref");
  if (status === "image_generated" && existingImage && fs.existsSync(existingImage)) {
    return {
      imagePath: existingImage,
      copyPath: stepField(task, "copy", "output_ref"),
      topicResearchPath: resolveTopicResearchPath(task),
      imageCount: 0,
    };
  }

  const copyPath = stepField(task, "copy", "output_ref");
  if (!copyPath || !fs.existsSync(copyPath)) {
    throw new Error(`generateImages: missing steps.copy.output_ref (${copyPath})`);
  }

  if (status === "copy_generated") {
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "image_generation_started",
        operator: params.operator?.trim() || "orchestrator",
        changedFields: ["status", "steps.image"],
        payload: {},
        mutate: (draft, context) => {
          draft.status = "generating_image";
          mergeStep(draft, "image", { status: "running", started_at: context.now });
        },
      },
      settings,
    );
  }

  const topicResearchPath = resolveTopicResearchPath(task);
  const researchArtifact = loadTopicResearchFile(topicResearchPath);
  const copyArtifact = loadCopyResult(copyPath);

  const taskId = typeof task.task_id === "string" ? task.task_id : researchArtifact.task_id;
  const runId = typeof task.run_id === "string" ? task.run_id : researchArtifact.run_id;
  const operator = params.operator?.trim() || "orchestrator";

  const baseDir = ensureTaskDirectories(settings, taskId);
  const imagesDir = path.resolve(baseDir, "generate", "images");
  fs.mkdirSync(imagesDir, { recursive: true });

  try {
  const researchByTopic = new Map(researchArtifact.items.map((it) => [it.topic_id, it]));
  const allImages: JsonObject[] = [];
  const stockPick = pickStockImages({
    taskId,
    runId,
    repoRoot: settings.repoRoot,
  });

  for (const copyItem of copyArtifact.items) {
    const researchItem = researchByTopic.get(copyItem.topic_id);
    const researchImages = researchItem?.research.images ?? [];
    const slots = mergeImagePromptSlots(researchImages, copyItem.image_prompts);
    const topicImagesDir = path.resolve(imagesDir, copyItem.topic_id.replace(/[^a-zA-Z0-9_-]/g, "_"));
    fs.mkdirSync(topicImagesDir, { recursive: true });

    let generated: GeneratedImageRecord[];
    if (stockPick) {
      generated = buildRecordsFromStock(slots, stockPick);
    } else {
    try {
      generated = await generateTopicImages({
        task_id: taskId,
        run_id: runId,
        topic_id: copyItem.topic_id,
        title: copyItem.title,
        output_dir: topicImagesDir,
        slots,
      });
    } catch (error) {
      const allowPromptOnly =
        settings.publishConfig.step6.image.prompt_only_on_failure ||
        process.env.PUBLISH_ORCH_STEP6_IMAGE_PROMPT_ONLY === "1" ||
        String(process.env.PUBLISH_ORCH_STEP6_IMAGE_PROMPT_ONLY ?? "").toLowerCase() === "true";
      if (!allowPromptOnly) throw error;
      generated = slots.map((slot) => ({
        slot_id: slot.slot_id,
        prompt: slot.merged_prompt,
        research_image_hint: slot.research_image_hint,
        copy_image_prompt: slot.copy_image_prompt,
        mode: "prompt_only",
        asset_path: "",
        status: "prompt_only",
        ...(slot.style ? { style: slot.style } : {}),
        ...(slot.aspect_ratio ? { aspect_ratio: slot.aspect_ratio } : {}),
      }));
    }
    }

    for (const img of generated) {
      allImages.push({
        topic_id: copyItem.topic_id,
        slot_id: img.slot_id,
        prompt: img.prompt,
        research_image_hint: img.research_image_hint,
        copy_image_prompt: img.copy_image_prompt,
        mode: img.mode,
        status: img.status,
        asset_path: img.asset_path,
        ...(img.style ? { style: img.style } : {}),
        ...(img.aspect_ratio ? { aspect_ratio: img.aspect_ratio } : {}),
      });
    }
  }

  const datePart = yyyymmddJst();
  const outName = `image_result_${datePart}_${runId}.json`;
  const imagePath = path.resolve(path.dirname(imagesDir), outName);

  const imageArtifact: JsonObject = {
    schema_version: "image_result.v1",
    generated_at: nowIsoJst(),
    task_id: taskId,
    run_id: runId,
    source_copy_ref: copyPath,
    source_topic_research_ref: topicResearchPath,
    ...(stockPick ?
      {
        image_source: stockPick.source,
        stock_pool_dir: stockPick.poolDir,
      }
    : { image_source: "ai_generated" }),
    images: allImages,
  };

  fs.writeFileSync(imagePath, JSON.stringify(imageArtifact, null, 2), "utf-8");

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: "images_generated",
      operator,
      changedFields: ["status", "steps.image"],
      payload: { image_ref: imagePath, image_count: allImages.length },
      mutate: (draft, context) => {
        draft.status = "image_generated";
        const promptOnly = allImages.length > 0 && allImages.every((img) => img.status === "prompt_only");
        if (promptOnly) draft.degraded = true;
        mergeStep(draft, "image", {
          status: "success",
          started_at: context.now,
          finished_at: context.now,
          input_ref: copyPath,
          output_ref: imagePath,
          ...(promptOnly ? { mode: "prompt_only" } : {}),
        });
      },
    },
    settings,
  );

  await notifyStepCompletedForTask({
    step: 6,
    taskJsonPath: params.taskJsonPath,
    settings,
    detail: formatStep6NotifyDetail({
      copyPath,
      imageCount: allImages.filter((img) => img.status === "success").length,
      imageSource: stockPick?.source ?? "ai_generated",
    }),
  });

  return {
    imagePath,
    copyPath,
    topicResearchPath,
    imageCount: allImages.length,
  };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "image_generation_failed",
        operator,
        changedFields: ["status", "steps.image"],
        payload: { error: message },
        mutate: (draft, context) => {
          draft.status = "copy_generated";
          mergeStep(draft, "image", {
            status: "failed",
            finished_at: context.now,
            input_ref: copyPath,
            error: message,
          });
        },
      },
      settings,
    );
    throw error;
  }
}
