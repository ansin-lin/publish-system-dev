import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSlackStep4Config } from "../orchestrator/orchestratorSlackConfig.js";
import { ensureTaskDirectories, loadTaskJson } from "../orchestrator/taskStore.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { notifyStepCompletedForTask } from "../orchestrator/stepCompletionSlack.js";
import { updateTask } from "../orchestrator/updateTask.js";
import { nowIsoJst, yyyymmddJst } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import {
  readTopicsForPick,
  resolveCandidatePickSourcePath,
  type PickListTopic,
} from "./slackNotify.js";
import { writeSelectedCollectItemsFile } from "./materializeSelectedCollect.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepStatus(task: JsonObject, stepName: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  return typeof step.status === "string" ? step.status : "";
}

function stepStringField(task: JsonObject, stepName: string, field: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const v = step[field];
  return typeof v === "string" ? v : "";
}

function stepStringArrayField(task: JsonObject, stepName: string, field: string): string[] {
  const steps = task.steps;
  if (!isObject(steps)) return [];
  const step = steps[stepName];
  if (!isObject(step)) return [];
  const v = step[field];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Slack 重复 pick 时回复管理者的固定文案 */
export const PICK_ALREADY_SELECTED_USER_MESSAGE = "今日话题已选择";

/**
 * Parse `pick 2,5,8` (1-based indices). Whitespace tolerant.
 */
export function parsePickIndices(rawInput: string): number[] {
  const trimmed = rawInput.trim();
  const m = trimmed.match(/^pick\s+([\d\s,]+)\s*$/i);
  if (!m) throw new Error('Expected input like: pick 2,5,8');
  const parts = m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = parts.map((p) => {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid index: ${p}`);
    return n;
  });
  const uniq = [...new Set(nums)];
  return uniq.sort((a, b) => a - b);
}

type Step4Selection =
  | { kind: "pick"; indices: number[] }
  | { kind: "title"; title: string };

function normalizeCustomTitle(raw: string): string {
  // Slack text can contain newlines; normalize for stable hashing & cleaner prompts.
  return raw.replace(/\s+/g, " ").trim();
}

function parseSelection(rawInput: string): Step4Selection {
  const trimmed = rawInput.trim();
  const pickMatch = trimmed.match(/^pick\s+([\d\s,]+)\s*$/i);
  if (pickMatch) return { kind: "pick", indices: parsePickIndices(trimmed) };

  const titleMatch = trimmed.match(/^title\s+([\s\S]+)$/i);
  if (titleMatch) {
    const title = normalizeCustomTitle(titleMatch[1] ?? "");
    if (!title) throw new Error('Expected input like: title Your topic title');
    return { kind: "title", title };
  }

  throw new Error('Expected input like: pick 2,5,8 OR title Your topic title');
}

function customTopicId(taskId: string, runId: string, title: string): string {
  const h = createHash("sha1").update(`${taskId}\n${runId}\n${title}`).digest("hex").slice(0, 16);
  return `custom_${h}`;
}

function topicsByIndex(topics: PickListTopic[]): Map<number, PickListTopic> {
  const m = new Map<number, PickListTopic>();
  for (const t of topics) m.set(t.index, t);
  return m;
}

function hasCompletedTopicResearch(task: JsonObject): boolean {
  const steps = task.steps;
  if (isObject(steps) && isObject(steps.research) && steps.research.status === "success") return true;
  const researchRef =
    stepStringField(task, "research", "output_ref") || stepStringField(task, "approve", "research_ref");
  return Boolean(researchRef && fs.existsSync(researchRef));
}

function writeSelectedTopicsFile(params: {
  approveDir: string;
  taskId: string;
  runId: string;
  operator: string;
  candidatesPath: string;
  indices: number[];
  items: PickListTopic[];
}): string {
  const datePart = yyyymmddJst();
  const outName = `selected_topics_${datePart}_${params.runId}.json`;
  const outputPath = path.resolve(params.approveDir, outName);
  const artifact: JsonObject = {
    schema_version: "selected_topics.v1",
    generated_at: nowIsoJst(),
    task_id: params.taskId,
    run_id: params.runId,
    source_candidates_ref: params.candidatesPath,
    selected_indices: [...params.indices],
    selected_topic_ids: params.items.map((t) => t.topic_id),
    selected_by: params.operator,
    selected_at: nowIsoJst(),
    items: params.items.map((t) => {
      const row: JsonObject = {
        index: t.index,
        topic_id: t.topic_id,
        title: t.title,
        source_platform: t.source_platform,
      };
      if (t.source_url) row.source_url = t.source_url;
      if (t.score !== undefined) row.score = t.score;
      return row;
    }),
  };
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), "utf-8");
  return outputPath;
}

export type ApplyPickParams = {
  taskJsonPath: string;
  rawInput: string;
  /** e.g. slack user id U0AU3C9CG7N or label `cli:local` */
  operator: string;
  settings?: OrchestratorSettings;
};

export type ApplyPickResult = {
  outputPath: string;
  collectItemsPath: string;
  selectedTopicIds: string[];
  /** 任务已完成选题，重复 pick 时为 true */
  alreadySelected?: boolean;
  userMessage?: string;
  /** manager_selected 但缺 collect 切片时可后台补 materialize-collect */
  needsCollectMaterialize?: boolean;
};

function buildAlreadySelectedResult(task: JsonObject): ApplyPickResult {
  const outputPath =
    stepStringField(task, "approve", "selected_topics_ref") ||
    stepStringField(task, "approve", "output_ref") ||
    stepStringField(task, "approve", "research_ref");
  const collectItemsPath = stepStringField(task, "approve", "collect_items_ref");
  const selectedTopicIds = stepStringArrayField(task, "approval", "parsed_selection");
  const needsCollectMaterialize =
    !collectItemsPath || !fs.existsSync(collectItemsPath);
  return {
    outputPath,
    collectItemsPath,
    selectedTopicIds,
    alreadySelected: true,
    userMessage: PICK_ALREADY_SELECTED_USER_MESSAGE,
    needsCollectMaterialize,
  };
}

export async function applyManagerPick(params: ApplyPickParams): Promise<ApplyPickResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";

  if (hasCompletedTopicResearch(task)) {
    return buildAlreadySelectedResult(task);
  }

  if (status === "topics_selected" || status === "generating_research") {
    throw new Error(
      "applyManagerPick: Step4 pick already applied; Step5 research is pending or running — use run-once or wait for orchestrator",
    );
  }

  if (status !== "awaiting_manager_selection") {
    throw new Error(`applyManagerPick: task.status must be awaiting_manager_selection (got ${status})`);
  }
  const approvalStatus = stepStatus(task, "approval");
  if (approvalStatus !== "running") {
    throw new Error(`applyManagerPick: steps.approval.status must be running (got ${approvalStatus})`);
  }

  const slackCfg = loadOrchestratorSlackStep4Config(
    { repoRoot: settings.repoRoot },
    { requireSlackBotToken: false, requireSlackChannel: false },
  );
  const allow = slackCfg.slack.allowedSlackUserIds;
  if (allow.length && !allow.includes(params.operator)) {
    throw new Error(
      `Operator ${params.operator} is not in allowed_slack_user_ids / PUBLISH_ORCH_SLACK_ALLOWED_USERS`,
    );
  }

  const candidatesPath = resolveCandidatePickSourcePath(params.taskJsonPath);
  const selection = parseSelection(params.rawInput);

  let indices: number[] = [];
  let selected: PickListTopic[] = [];

  if (selection.kind === "pick") {
    indices = selection.indices;
    const topics = readTopicsForPick(candidatesPath);
    const byIdx = topicsByIndex(topics);
    selected = [];
    for (const idx of indices) {
      const t = byIdx.get(idx);
      if (!t) throw new Error(`Index ${idx} is out of range (1..${topics.length})`);
      selected.push(t);
    }
  } else {
    const taskId = typeof task.task_id === "string" ? task.task_id : "";
    const runId = typeof task.run_id === "string" ? task.run_id : "";
    const title = selection.title;
    if (title.length < 8) throw new Error("Title is too short; please provide at least 8 characters");
    if (title.length > 120) throw new Error("Title is too long; please keep within 120 characters");
    selected = [
      {
        index: 0,
        topic_id: customTopicId(taskId, runId, title),
        title,
        source_platform: "custom",
      },
    ];
    indices = [];
  }

  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "";
  const baseDir = ensureTaskDirectories(settings, taskId);
  const approveDir = path.resolve(baseDir, "approve");
  fs.mkdirSync(approveDir, { recursive: true });

  const selectedIds = selected.map((t) => t.topic_id);

  const collectSlice = writeSelectedCollectItemsFile({
    taskJsonPath: params.taskJsonPath,
    indices,
    taskId,
    runId,
  });

  const topicsPath = writeSelectedTopicsFile({
    approveDir,
    taskId,
    runId,
    operator: params.operator,
    candidatesPath,
    indices,
    items: selected,
  });

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: "manager_pick_applied",
      operator: params.operator,
      changedFields: ["status", "steps.approval", "steps.approve"],
      payload: {
        selected_topics_ref: topicsPath,
        collect_items_ref: collectSlice.outputPath,
        parsed_selection: selectedIds,
        selected_indices: indices,
      },
      mutate: (draft, context) => {
        draft.status = "topics_selected";
        mergeStep(draft, "approval", {
          status: "success",
          finished_at: context.now,
          raw_input: params.rawInput.trim(),
          parsed_selection: selectedIds,
          operator: params.operator,
          at: context.now,
        });
        mergeStep(draft, "approve", {
          status: "success",
          started_at: context.now,
          finished_at: context.now,
          input_ref: candidatesPath,
          selected_topics_ref: topicsPath,
          output_ref: topicsPath,
          collect_items_ref: collectSlice.outputPath,
        });
        mergeStep(draft, "research", { status: "pending" });
      },
    },
    settings,
  );

  await notifyStepCompletedForTask({
    step: 4,
    taskJsonPath: params.taskJsonPath,
    settings,
    detail: `已选 ${selectedIds.length} 个话题`,
  });

  return {
    outputPath: topicsPath,
    collectItemsPath: collectSlice.outputPath,
    selectedTopicIds: selectedIds,
  };
}
