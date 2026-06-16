import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { ensureTaskDirectories, getRevision, loadTaskJson } from "../orchestrator/taskStore.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { nowIsoJst, yyyymmddJst } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { updateTask } from "../orchestrator/updateTask.js";
import { readTopicsForPick, resolveCandidatePickSourcePath } from "./slackNotify.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepObj(task: JsonObject, name: string): JsonObject | null {
  const steps = task.steps;
  if (!isObject(steps)) return null;
  const s = steps[name];
  return isObject(s) ? s : null;
}

/** Parse `44` / `1,3` / `pick 2,5` into 1-based indices. */
export function parseIndicesArg(raw: string): number[] {
  const t = raw.trim();
  if (/^pick\s/i.test(t)) {
    const m = t.match(/^pick\s+([\d\s,]+)\s*$/i);
    if (!m) throw new Error('Expected "pick 1,2" or comma-separated indices');
    const parts = m[1]!.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    return uniqSortedInts(parts);
  }
  const parts = t.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  return uniqSortedInts(parts);
}

function uniqSortedInts(parts: string[]): number[] {
  const nums = parts.map((p) => {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid index: ${p}`);
    return n;
  });
  return [...new Set(nums)].sort((a, b) => a - b);
}

function readJsonObject(filePath: string): JsonObject {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  if (!isObject(raw)) throw new Error(`Expected JSON object: ${filePath}`);
  return raw;
}

function collectOutputPath(task: JsonObject, taskJsonPath: string): string {
  const c = stepObj(task, "collect");
  const ref = c && typeof c.output_ref === "string" ? c.output_ref.trim() : "";
  if (!ref) throw new Error("steps.collect.output_ref is missing");
  return path.isAbsolute(ref) ? path.resolve(ref) : path.resolve(path.dirname(taskJsonPath), ref);
}

export type MaterializeSelectedCollectResult = {
  outputPath: string;
  matchedCount: number;
  selectedIndices: number[];
  topicKeys: { topic_id: string; source_platform: string }[];
};

/**
 * From topic_candidates indices, copy full matching items from collect_result (topic_id + source_platform).
 */
export function writeSelectedCollectItemsFile(params: {
  taskJsonPath: string;
  indices: number[];
  taskId: string;
  runId: string;
}): MaterializeSelectedCollectResult {
  const task = loadTaskJson(params.taskJsonPath);
  const candidatesPath = resolveCandidatePickSourcePath(params.taskJsonPath);
  const collectPath = collectOutputPath(task, params.taskJsonPath);

  const topics = readTopicsForPick(candidatesPath);
  const byIndex = new Map(topics.map((t) => [t.index, t]));
  const keys: { topic_id: string; source_platform: string }[] = [];
  for (const idx of params.indices) {
    const row = byIndex.get(idx);
    if (!row) throw new Error(`Index ${idx} not found in candidates (1..${topics.length})`);
    keys.push({ topic_id: row.topic_id, source_platform: row.source_platform });
  }

  const collectDoc = readJsonObject(collectPath);
  const items = collectDoc.items;
  if (!Array.isArray(items)) throw new Error("collect_result.items must be an array");

  const picked = new Set(keys.map((k) => `${k.topic_id}\0${k.source_platform}`));
  const byKey = new Map<string, JsonObject>();
  for (const it of items) {
    if (!isObject(it)) continue;
    const tid = typeof it.topic_id === "string" ? it.topic_id : "";
    const plat = typeof it.source_platform === "string" ? it.source_platform : "";
    const key = `${tid}\0${plat}`;
    if (picked.has(key) && !byKey.has(key)) byKey.set(key, it);
  }

  const outItems: JsonObject[] = [];
  for (const k of keys) {
    const key = `${k.topic_id}\0${k.source_platform}`;
    const row = byKey.get(key);
    if (!row) {
      throw new Error(
        `collect_result has no item for topic_id=${k.topic_id} source_platform=${k.source_platform}`,
      );
    }
    outItems.push(row);
  }

  const taskDir = path.dirname(params.taskJsonPath);
  const approveDir = path.resolve(taskDir, "approve");
  fs.mkdirSync(approveDir, { recursive: true });
  const datePart = yyyymmddJst();
  const outName = `selected_collect_items_${datePart}_${params.runId}.json`;
  const outputPath = path.resolve(approveDir, outName);

  const artifact: JsonObject = {
    schema_version: "selected_collect_items.v1",
    generated_at: nowIsoJst(),
    task_id: params.taskId,
    run_id: params.runId,
    source_collect_ref: collectPath,
    source_candidates_ref: candidatesPath,
    selected_indices: [...params.indices],
    topic_keys: keys,
    items: outItems,
  };

  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), "utf-8");

  return {
    outputPath,
    matchedCount: outItems.length,
    selectedIndices: [...params.indices],
    topicKeys: keys,
  };
}

/** When task is already manager_selected: write slice + attach ref on approve (no status change). */
export async function materializeCollectForManagerSelectedTask(params: {
  taskJsonPath: string;
  indices: number[];
  settings: OrchestratorSettings;
}): Promise<MaterializeSelectedCollectResult & { revision: number }> {
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";
  if (
    status !== "research_done" &&
    status !== "manager_selected" &&
    status !== "topics_selected" &&
    status !== "generating_research"
  ) {
    throw new Error(
      `materialize-collect: task.status must be topics_selected|generating_research|research_done|manager_selected (got ${status})`,
    );
  }
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "";
  ensureTaskDirectories(params.settings, taskId);

  const slice = writeSelectedCollectItemsFile({
    taskJsonPath: params.taskJsonPath,
    indices: params.indices,
    taskId,
    runId,
  });

  const result = await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: "selected_collect_items_materialized",
      operator: "cli:materialize-collect",
      changedFields: ["steps.approve"],
      payload: { collect_items_ref: slice.outputPath, selected_indices: slice.selectedIndices },
      mutate: (draft, context) => {
        mergeStep(draft, "approve", {
          collect_items_ref: slice.outputPath,
          collect_items_materialized_at: context.now,
        });
      },
    },
    params.settings,
  );

  return { ...slice, revision: getRevision(result.task) };
}
