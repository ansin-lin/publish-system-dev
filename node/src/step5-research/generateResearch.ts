import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { getStaleThresholdMs } from "../orchestrator/publishOrchestratorConfig.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { ensureTaskDirectories, loadTaskJson } from "../orchestrator/taskStore.js";
import { ageMsSinceIsoJst } from "../orchestrator/time.js";
import { notifyStepCompletedForTask } from "../orchestrator/stepCompletionSlack.js";
import { updateTask } from "../orchestrator/updateTask.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import type { PickListTopic } from "../step4-approval/slackNotify.js";
import {
  buildTopicResearchItems,
  collectHintsFromCollectItems,
  writeTopicResearchFile,
} from "../step4-approval/topicResearch.js";

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

function readSelectedTopicsFile(filePath: string): {
  items: PickListTopic[];
  candidatesPath: string;
  indices: number[];
  selectedTopicsPath: string;
  selectedBy: string;
} {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("selected_topics file must be a JSON object");

  const candidatesPath =
    typeof raw.source_candidates_ref === "string" ? raw.source_candidates_ref : "";
  const indices = Array.isArray(raw.selected_indices) ?
    raw.selected_indices.filter((n): n is number => typeof n === "number" && Number.isInteger(n))
  : [];

  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    throw new Error("selected_topics.items is empty");
  }

  const items: PickListTopic[] = [];
  for (let i = 0; i < itemsRaw.length; i += 1) {
    const row = itemsRaw[i];
    if (!isObject(row)) continue;
    const topic_id = typeof row.topic_id === "string" ? row.topic_id : "";
    const title = typeof row.title === "string" ? row.title : "";
    const source_platform = typeof row.source_platform === "string" ? row.source_platform : "";
    if (!topic_id || !title) throw new Error("selected_topics item missing topic_id or title");
    const index = typeof row.index === "number" ? row.index : i + 1;
    const t: PickListTopic = { index, topic_id, title, source_platform };
    if (typeof row.source_url === "string" && row.source_url.trim()) t.source_url = row.source_url.trim();
    if (typeof row.score === "number") t.score = row.score;
    items.push(t);
  }

  const selectedBy = typeof raw.selected_by === "string" ? raw.selected_by : "orchestrator";

  return { items, candidatesPath, indices, selectedTopicsPath: filePath, selectedBy };
}

export type GenerateTopicResearchParams = {
  taskJsonPath: string;
  operator?: string;
  settings?: OrchestratorSettings;
};

export type GenerateTopicResearchResult = {
  selectedTopicsPath: string;
  topicResearchPath: string;
  collectItemsPath: string;
  itemCount: number;
};

/** Step5: selected_topics → content-research → approve/topic_research_*.json */
export async function generateTopicResearch(
  params: GenerateTopicResearchParams,
): Promise<GenerateTopicResearchResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  let task = loadTaskJson(params.taskJsonPath);
  let status = typeof task.status === "string" ? task.status : "";

  const allowedStatus = ["topics_selected", "generating_research", "research_done", "manager_selected"];
  if (!allowedStatus.includes(status)) {
    throw new Error(
      `generateTopicResearch (Step5): task.status must be topics_selected|generating_research|research_done (got ${status})`,
    );
  }

  const selectedPath = stepField(task, "approve", "selected_topics_ref") || stepField(task, "approve", "output_ref");
  if (!selectedPath || !selectedPath.includes("selected_topics") || !fs.existsSync(selectedPath)) {
    throw new Error(`generateTopicResearch (Step5): missing steps.approve.selected_topics_ref (${selectedPath})`);
  }

  const existingResearch =
    stepField(task, "research", "output_ref") || stepField(task, "approve", "research_ref");
  const skipIfExists = settings.publishConfig.step5.skip_if_research_exists;
  if (skipIfExists && existingResearch && fs.existsSync(existingResearch)) {
    if (status === "manager_selected" || status === "generating_research") {
      await updateTask(
        {
          taskJsonPath: params.taskJsonPath,
          reason: "step5_research_already_present",
          operator: params.operator?.trim() || "orchestrator",
          changedFields: ["status", "steps.research", "steps.approve"],
          payload: { research_ref: existingResearch },
          mutate: (draft, context) => {
            draft.status = "research_done";
            mergeStep(draft, "research", {
              status: "success",
              finished_at: context.now,
              output_ref: existingResearch,
              input_ref: selectedPath,
            });
            mergeStep(draft, "approve", {
              research_ref: existingResearch,
              topic_research_at: context.now,
            });
          },
        },
        settings,
      );
    }
    return {
      selectedTopicsPath: selectedPath,
      topicResearchPath: existingResearch,
      collectItemsPath: stepField(task, "approve", "collect_items_ref"),
      itemCount: 0,
    };
  }

  const approveStatus = stepStatus(task, "approve");
  if (status === "topics_selected" && approveStatus !== "success") {
    throw new Error(`generateTopicResearch (Step5): steps.approve must be success after pick (got ${approveStatus})`);
  }

  const researchStatus = stepStatus(task, "research");
  if (researchStatus === "running") {
    const researchOutput =
      stepField(task, "research", "output_ref") || stepField(task, "approve", "research_ref");
    const hasResearchFile = Boolean(researchOutput && fs.existsSync(researchOutput));
    if (!hasResearchFile) {
      const startedAt = stepField(task, "research", "started_at");
      const thresholdMs = getStaleThresholdMs("research");
      const ageMs = startedAt ? ageMsSinceIsoJst(startedAt) : null;
      if (ageMs === null || ageMs < thresholdMs) {
        throw new Error(
          `STEP5_RESEARCH_IN_PROGRESS: research running since ${startedAt || "unknown"}; wait for agent or stale rollback (${thresholdMs}ms)`,
        );
      }
      const operatorForReset =
        params.operator?.trim() ||
        stepField(task, "approval", "operator") ||
        stepField(task, "approve", "operator") ||
        "orchestrator";
      await updateTask(
        {
          taskJsonPath: params.taskJsonPath,
          reason: "step5_research_stale_running_reset",
          operator: operatorForReset,
          changedFields: ["status", "steps.research"],
          payload: { started_at: startedAt, age_ms: ageMs, threshold_ms: thresholdMs },
          mutate: (draft, context) => {
            draft.status = "topics_selected";
            mergeStep(draft, "research", {
              status: "failed",
              finished_at: context.now,
              input_ref: selectedPath,
              error: "stale running without topic_research output; reset for retry",
            });
          },
        },
        settings,
      );
      task = loadTaskJson(params.taskJsonPath);
      status = typeof task.status === "string" ? task.status : status;
    }
  }

  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "";
  const operator =
    params.operator?.trim() ||
    stepField(task, "approval", "operator") ||
    stepField(task, "approve", "operator") ||
    "orchestrator";

  if (status === "topics_selected") {
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "step5_research_started",
        operator,
        changedFields: ["status", "steps.research"],
        payload: { selected_topics_ref: selectedPath },
        mutate: (draft, context) => {
          draft.status = "generating_research";
          mergeStep(draft, "research", {
            status: "running",
            started_at: context.now,
            input_ref: selectedPath,
          });
        },
      },
      settings,
    );
  }

  const { items, candidatesPath, indices, selectedBy } = readSelectedTopicsFile(selectedPath);
  const collectItemsPath = stepField(task, "approve", "collect_items_ref");
  const hints = collectHintsFromCollectItems(collectItemsPath || null);

  const baseDir = ensureTaskDirectories(settings, taskId);
  const approveDir = path.resolve(baseDir, "approve");

  let itemsWithResearch;
  let researchPath: string;
  try {
    itemsWithResearch = await buildTopicResearchItems(items, taskId, runId, hints);
    researchPath = writeTopicResearchFile({
      approveDir,
      taskId,
      runId,
      operator: selectedBy || operator,
      candidatesPath: candidatesPath || stepField(task, "tidy", "output_ref"),
      selectedTopicsPath: selectedPath,
      selectedIndices: indices.length ? indices : items.map((t) => t.index),
      items: itemsWithResearch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "step5_topic_research_failed",
        operator,
        changedFields: ["status", "steps.research"],
        payload: { error: message },
        mutate: (draft, context) => {
          draft.status = "topics_selected";
          mergeStep(draft, "research", {
            status: "failed",
            finished_at: context.now,
            input_ref: selectedPath,
            error: message,
          });
        },
      },
      settings,
    );
    throw error;
  }

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: "step5_topic_research_generated",
      operator,
      changedFields: ["status", "steps.research", "steps.approve"],
      payload: {
        selected_topics_ref: selectedPath,
        research_ref: researchPath,
        collect_items_ref: collectItemsPath || undefined,
        item_count: itemsWithResearch.length,
      },
      mutate: (draft, context) => {
        draft.status = "research_done";
        mergeStep(draft, "research", {
          status: "success",
          finished_at: context.now,
          output_ref: researchPath,
          input_ref: selectedPath,
          operator,
        });
        mergeStep(draft, "approve", {
          research_ref: researchPath,
          topic_research_at: context.now,
        });
      },
    },
    settings,
  );

  await notifyStepCompletedForTask({
    step: 5,
    taskJsonPath: params.taskJsonPath,
    settings,
    detail: `调研条目 ${itemsWithResearch.length} 条`,
  });

  return {
    selectedTopicsPath: selectedPath,
    topicResearchPath: researchPath,
    collectItemsPath: collectItemsPath,
    itemCount: itemsWithResearch.length,
  };
}
