import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { advanceTaskPipelineUntilIdle } from "../orchestrator/pipelineAdvance.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import {
  applyManagerPick,
  parsePickIndices,
  PICK_ALREADY_SELECTED_USER_MESSAGE,
  type ApplyPickParams,
  type ApplyPickResult,
} from "./applyPick.js";
import { materializeCollectForManagerSelectedTask } from "./materializeSelectedCollect.js";

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

export type CompleteStep4PickParams = ApplyPickParams & {
  /** When true, run Step5/6 via orchestrator after pick (default false; use run-once / dispatcher). */
  advancePipeline?: boolean;
};

export type CompleteStep4PickResult = ApplyPickResult & {
  topicResearchPath?: string;
  research_ref?: string;
  researchItemCount?: number;
  pipelineFinalStatus?: string;
};

/**
 * Step4b only: Slack pick → selected_topics + selected_collect_items → topics_selected.
 * Step5/6 run via outbox when advancePipeline is true (default from publish.orchestrator.json step4.pick_advance_pipeline_default).
 */
export async function completeStep4Pick(params: CompleteStep4PickParams): Promise<CompleteStep4PickResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const defaultAdvance = settings.publishConfig.step4.pick_advance_pipeline_default;
  const advancePipeline = params.advancePipeline ?? defaultAdvance;
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";
  const taskId = typeof task.task_id === "string" ? task.task_id : "";

  const researchRef =
    stepField(task, "research", "output_ref") || stepField(task, "approve", "research_ref");
  if (researchRef && fs.existsSync(researchRef)) {
    const base = buildAlreadyFromTask(task);
    if (base.needsCollectMaterialize) {
      await materializeCollectForManagerSelectedTask({
        taskJsonPath: params.taskJsonPath,
        indices: parsePickIndices(params.rawInput),
        settings,
      });
    }
    if (advancePipeline && taskId) {
      const advanced = await advanceTaskPipelineUntilIdle(taskId, settings);
      return {
        ...base,
        topicResearchPath: researchRef,
        research_ref: researchRef,
        pipelineFinalStatus: advanced.finalStatus,
      };
    }
    return { ...base, topicResearchPath: researchRef, research_ref: researchRef };
  }

  let pickResult: ApplyPickResult;
  if (status === "awaiting_manager_selection") {
    pickResult = await applyManagerPick(params);
  } else if (
    status === "topics_selected" ||
    status === "generating_research" ||
    status === "research_done" ||
    status === "manager_selected"
  ) {
    pickResult = buildAlreadyFromTask(task);
    pickResult.alreadySelected = true;
    pickResult.userMessage = PICK_ALREADY_SELECTED_USER_MESSAGE;
  } else {
    throw new Error(`completeStep4Pick: unexpected task.status ${status}`);
  }

  if (!advancePipeline || !taskId) {
    return pickResult;
  }

  const advanced = await advanceTaskPipelineUntilIdle(taskId, settings);
  const after = loadTaskJson(params.taskJsonPath);
  const topicResearchPath =
    stepField(after, "research", "output_ref") || stepField(after, "approve", "research_ref");

  const out: CompleteStep4PickResult = {
    ...pickResult,
    pipelineFinalStatus: advanced.finalStatus,
  };
  if (topicResearchPath) {
    out.topicResearchPath = topicResearchPath;
    out.research_ref = topicResearchPath;
  }
  return out;
}

function buildAlreadyFromTask(task: JsonObject): CompleteStep4PickResult {
  const outputRef = stepField(task, "approve", "output_ref");
  const outputPath =
    stepField(task, "approve", "selected_topics_ref") ||
    (outputRef.includes("selected_topics") ? outputRef : "");
  const collectItemsPath = stepField(task, "approve", "collect_items_ref");
  const steps = task.steps;
  let selectedTopicIds: string[] = [];
  if (isObject(steps) && isObject(steps.approval) && Array.isArray(steps.approval.parsed_selection)) {
    selectedTopicIds = steps.approval.parsed_selection.filter((x): x is string => typeof x === "string");
  }
  const needsCollectMaterialize = !collectItemsPath || !fs.existsSync(collectItemsPath);
  return {
    outputPath,
    collectItemsPath,
    selectedTopicIds,
    alreadySelected: true,
    userMessage: PICK_ALREADY_SELECTED_USER_MESSAGE,
    needsCollectMaterialize,
  };
}
