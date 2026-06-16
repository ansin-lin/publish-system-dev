import { randomUUID } from "node:crypto";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSettings } from "./config.js";
import { createOutboxRepo } from "./outboxRepo.js";
import { saveTaskJsonAtomic, getRevision, getString, loadTaskJson } from "./taskStore.js";
import { withTaskLock } from "./taskLock.js";
import { nowIsoJst } from "./time.js";
import { assertValidTransition } from "./transitionGuard.js";
import type { OrchestratorSettings, TaskJson, UpdateTaskParams, UpdateTaskResult } from "./types.js";

function ensureHistory(task: TaskJson): JsonObject[] {
  if (task.history === undefined) task.history = [];
  if (!Array.isArray(task.history)) throw new Error("task.history must be an array");
  return task.history as JsonObject[];
}

function ensureOrchestratorMeta(task: TaskJson): JsonObject {
  const current = task.orchestrator_meta;
  if (current && typeof current === "object" && !Array.isArray(current)) return current as JsonObject;
  const next: JsonObject = {};
  task.orchestrator_meta = next;
  return next;
}

export async function updateTask(params: UpdateTaskParams, settings: OrchestratorSettings = loadOrchestratorSettings()): Promise<UpdateTaskResult> {
  const initial = loadTaskJson(params.taskJsonPath);
  const taskId = getString(initial, "task_id");

  return await withTaskLock(taskId, async () => {
    const task = loadTaskJson(params.taskJsonPath);
    const lockedTaskId = getString(task, "task_id");
    const runId = getString(task, "run_id");
    const previousRevision = getRevision(task);
    const previousStatus = task.status;
    const now = nowIsoJst();

    await params.mutate(task, { now, previousRevision });
    assertValidTransition(previousStatus, task.status);

    const nextRevision = previousRevision + 1;
    const eventId = `evt_${randomUUID()}`;
    task.revision = nextRevision;
    task.updated_at = now;

    const history = ensureHistory(task);
    history.push({
      at: now,
      event: params.reason,
      operator: params.operator ?? "orchestrator",
      data: params.payload ?? {},
    });

    const meta = ensureOrchestratorMeta(task);
    meta.last_event_id = eventId;

    saveTaskJsonAtomic(params.taskJsonPath, task);

    const repo = createOutboxRepo(settings);
    try {
      repo.init();
      const event = repo.insertEvent({
        eventId,
        eventType: "TASK_UPDATED",
        taskId: lockedTaskId,
        runId,
        revision: nextRevision,
        payload: {
          changed_by: params.operator ?? "orchestrator",
          changed_fields: params.changedFields ?? [],
          reason: params.reason,
          ...(params.payload ? { data: params.payload } : {}),
        },
        now,
      });
      return { taskJsonPath: params.taskJsonPath, task, event };
    } finally {
      repo.close();
    }
  });
}
