import path from "node:path";
import {
  buildStep2Config,
  loadAggregateConfig,
  loadCollectSettings,
  loadStandaloneConfig,
  resolveCollectInputPath,
} from "./config.js";
import { createCollectLogger } from "./logger.js";
import { runStep2Collect } from "./runner.js";
import {
  buildStepLogPath,
  collectResultPath,
  loadTask,
  saveTask,
  updateCollectStep,
  writeCollectResult,
} from "./taskStore.js";
import type { CollectRuntimeSettings, CollectTaskParams, CollectTaskRunResult } from "./types.js";

function nonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`task.json must contain non-empty ${fieldName}`);
  return value.trim();
}

export async function collectTask(params: CollectTaskParams): Promise<CollectTaskRunResult> {
  const run = await executeCollectTask(params);
  const task = loadTask(run.taskPath);
  updateCollectStep(task, run.outputPath, run.result);
  saveTask(run.taskPath, task);
  const logger = createCollectLogger(run.logPath);
  logger.info(`task updated: ${path.resolve(run.taskPath)}`);

  return { taskPath: run.taskPath, outputPath: run.outputPath, result: run.result };
}

export async function executeCollectTask(params: CollectTaskParams): Promise<CollectTaskRunResult & { logPath: string }> {
  const settings: CollectRuntimeSettings = params.settings ?? loadCollectSettings();
  const taskPath = resolveCollectInputPath(settings, params.taskJsonPath);
  const task = loadTask(taskPath);
  const taskId = nonEmptyString(task.task_id, "task_id");
  const runId = nonEmptyString(task.run_id, "run_id");

  const logPath = buildStepLogPath(settings.paths, "step2", taskId);
  const logger = createCollectLogger(logPath);
  logger.info(`step2 start task_id=${taskId} run_id=${runId} task_json=${taskPath}`);

  const aggregateConfig = loadAggregateConfig(settings, params.aggregateConfigPath);
  const standaloneConfig = loadStandaloneConfig(settings, params.standaloneConfigPath);
  const cfg = buildStep2Config(aggregateConfig, standaloneConfig);

  const result = await runStep2Collect({ taskId, runId, cfg, settings });
  const outputPath = collectResultPath(settings.paths, taskId, runId);
  writeCollectResult(outputPath, result);
  logger.info(`collect_result written: ${outputPath} items=${result.items.length} errors=${result.errors.length}`);

  return { taskPath, outputPath, result, logPath };
}

export async function runCollect(params: CollectTaskParams): Promise<CollectTaskRunResult["result"]> {
  return (await collectTask(params)).result;
}
