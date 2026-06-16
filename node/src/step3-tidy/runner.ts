import fs from "node:fs";
import path from "path";
import type { JsonObject } from "../step2-collect/types.js";
import { nowIsoJst, yyyymmddJst } from "../step2-collect/time.js";
import { getString, loadTaskJson } from "../orchestrator/taskStore.js";
import type { TidyFromCollectExecution } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(filePath: string): JsonObject {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  if (!isObject(raw)) throw new Error(`${filePath} must be a JSON object`);
  return raw;
}

function collectOutputRef(task: JsonObject): string {
  if (!isObject(task.steps)) throw new Error("task.steps must be an object");
  const collect = task.steps.collect;
  if (!isObject(collect)) throw new Error("task.steps.collect must be an object");
  const outputRef = collect.output_ref;
  if (typeof outputRef !== "string" || !outputRef.trim()) throw new Error("task.steps.collect.output_ref is required");
  return path.resolve(outputRef);
}

function topicCandidatesOutputPath(taskJsonPath: string, runId: string): string {
  const taskDir = path.dirname(taskJsonPath);
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.resolve(taskDir, "tidy", `topic_candidates_${yyyymmddJst()}_${safeRunId}.json`);
}

function failurePatch(code: string, message: string, retryable: boolean, startedAt: string): JsonObject {
  return {
    status: "failed",
    started_at: startedAt,
    finished_at: nowIsoJst(),
    error: { code, message, retryable },
  };
}

/**
 * Reads collect_result and writes topic_candidates.v1 (numbered list for Slack pick).
 * No LLM / analyzer-role.
 */
export async function executeTidyFromCollect(params: { taskJsonPath: string }): Promise<TidyFromCollectExecution> {
  const startedAt = nowIsoJst();
  const task = loadTaskJson(params.taskJsonPath);
  const taskId = getString(task, "task_id");
  const runId = getString(task, "run_id");
  const collectPath = collectOutputRef(task);
  const collect = readJsonObject(collectPath);

  if (collect.task_id !== taskId || collect.run_id !== runId) {
    return {
      ok: false,
      stepPatch: failurePatch("TIDY_INPUT_MISMATCH", "collect_result task_id/run_id does not match task.json", false, startedAt),
    };
  }

  const itemsRaw = collect.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return {
      ok: false,
      stepPatch: failurePatch("TIDY_EMPTY_INPUT", "collect_result.items is empty", false, startedAt),
    };
  }

  const rows: JsonObject[] = [];
  let index = 1;
  for (const item of itemsRaw) {
    if (!isObject(item)) continue;
    const topicId = typeof item.topic_id === "string" ? item.topic_id.trim() : typeof item.id === "string" ? item.id.trim() : "";
    if (!topicId) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const sourcePlatform =
      typeof item.source_platform === "string" ? item.source_platform.trim()
      : typeof item.platform === "string" ? item.platform.trim()
      : "";
    const sourceUrl =
      typeof item.source_url === "string" ? item.source_url.trim() : typeof item.url === "string" ? item.url.trim() : "";
    rows.push({
      index,
      topic_id: topicId,
      title: title || "(no title)",
      source_platform: sourcePlatform,
      source_url: sourceUrl,
    });
    index += 1;
  }

  if (rows.length === 0) {
    return {
      ok: false,
      stepPatch: failurePatch("TIDY_NO_TOPIC_IDS", "collect_result has no items with topic_id", false, startedAt),
    };
  }

  const outputPath = topicCandidatesOutputPath(params.taskJsonPath, runId);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const artifact: JsonObject = {
    schema_version: "topic_candidates.v1",
    generated_at: nowIsoJst(),
    task_id: taskId,
    run_id: runId,
    source_collect_ref: collectPath,
    items: rows,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

  return {
    ok: true,
    outputPath,
    stepPatch: {
      status: "success",
      started_at: startedAt,
      finished_at: nowIsoJst(),
      output_ref: outputPath,
      input_ref: collectPath,
      tidy_version: "tidy_from_collect.v1",
    },
  };
}
