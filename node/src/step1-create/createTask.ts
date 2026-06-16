import fs from "node:fs";
import path from "node:path";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { ensureTaskDirectories, saveTaskJsonAtomic, taskJsonPath } from "../orchestrator/taskStore.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { nowIsoJst, yyyymmddHhmmssJst, yyyymmddJst } from "../orchestrator/time.js";
import { notifyStepCompleted } from "../orchestrator/stepCompletionSlack.js";
import { buildStep1NotifyDetail } from "../orchestrator/stepNotifyDetail.js";
import { updateTask } from "../orchestrator/updateTask.js";
import type { OrchestratorSettings, TaskJson } from "../orchestrator/types.js";

export type CreateTaskParams = {
  taskId?: string;
  runId?: string;
  trigger?: string;
  settings?: OrchestratorSettings;
};

function defaultTaskId(settings: OrchestratorSettings): string {
  const step1 = settings.publishConfig.step1;
  const fmt = step1.task_id_date_format;
  if (fmt === "daily-YYYYMMDD") {
    return `daily-${yyyymmddJst()}-${step1.default_run_id}`;
  }
  return `${yyyymmddHhmmssJst()}-dbg`;
}

export async function createTask(params: CreateTaskParams = {}) {
  const settings = params.settings ?? loadOrchestratorSettings();
  const taskId = params.taskId?.trim() || defaultTaskId(settings);
  const runId = params.runId?.trim() || settings.publishConfig.step1.default_run_id;
  const trigger = params.trigger?.trim() || settings.publishConfig.step1.default_trigger;
  ensureTaskDirectories(settings, taskId);
  const tpath = taskJsonPath(settings, taskId);
  if (fs.existsSync(tpath)) throw new Error(`task already exists: ${tpath}`);

  const now = nowIsoJst();
  const task: TaskJson = {
    schema_version: "task-schema.v1",
    pipeline_version: "publish-orchestrator.v2.1",
    task_id: taskId,
    run_id: runId,
    revision: 0,
    status: "created",
    degraded: false,
    created_at: now,
    updated_at: now,
    steps: {
      collect: { status: "pending" },
      tidy: { status: "pending" },
      approval: { status: "pending" },
      approve: { status: "pending" },
      research: { status: "pending" },
      copy: { status: "pending" },
      image: { status: "pending" },
      publish: { status: "pending" },
    },
    history: [
      {
        at: now,
        event: "task_created",
        operator: "orchestrator",
        data: { trigger },
      },
    ],
  };
  saveTaskJsonAtomic(tpath, task);

  const updated = await updateTask(
    {
      taskJsonPath: tpath,
      reason: "collect_started",
      changedFields: ["steps.collect", "status"],
      payload: { trigger },
      mutate: (draft, context) => {
        mergeStep(draft, "collect", { status: "running", started_at: context.now });
        draft.status = "collecting";
      },
    },
    settings,
  );

  await notifyStepCompleted({
    step: 1,
    taskId,
    runId,
    settings,
    detail: buildStep1NotifyDetail(),
  });

  return {
    taskId,
    runId,
    taskPath: path.resolve(tpath),
    event: updated.event,
  };
}
