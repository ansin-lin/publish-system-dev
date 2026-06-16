import type { JsonObject } from "../../../node/src/step2-collect/types.js";
import { loadOrchestratorSettings } from "../../../node/src/orchestrator/config.js";
import {
  listTaskJsonPaths,
  loadTaskJson,
  taskJsonPath,
} from "../../../node/src/orchestrator/taskStore.js";
import type { OrchestratorSettings } from "../../../node/src/orchestrator/types.js";
import type { DaySummaryDto, TaskSummaryDto } from "../types/dto.js";
import { compareYmd, isYmdInRange, parseToYmd, todayYmdJst } from "../utils/dateJst.js";
import { extractDateYmdFromTask, toDaySummaryDto, toTaskSummaryDto } from "./taskMapper.js";

export type TaskRecord = {
  taskId: string;
  taskJsonPath: string;
  task: JsonObject;
  dateYmd: string | null;
};

function loadAllRecords(settings: OrchestratorSettings): TaskRecord[] {
  return listTaskJsonPaths(settings).map((p) => {
    const task = loadTaskJson(p) as JsonObject;
    const taskId = typeof task.task_id === "string" ? task.task_id : "";
    const createdAt = typeof task.created_at === "string" ? task.created_at : undefined;
    return {
      taskId,
      taskJsonPath: p,
      task,
      dateYmd: extractDateYmdFromTask(taskId, createdAt),
    };
  });
}

export function createTaskService(settings: OrchestratorSettings = loadOrchestratorSettings()) {
  const defaultRunId = settings.publishConfig.step1.default_run_id;

  function listAll(): TaskRecord[] {
    return loadAllRecords(settings);
  }

  function getById(taskId: string): TaskSummaryDto | null {
    const path = taskJsonPath(settings, taskId);
    try {
      const task = loadTaskJson(path) as JsonObject;
      return toTaskSummaryDto(task);
    } catch {
      return null;
    }
  }

  function listTasksForDate(dateYmd: string): TaskSummaryDto[] {
    const prefix = `daily-${dateYmd}-`;
    return listAll()
      .filter((r) => r.taskId.startsWith(prefix) || r.dateYmd === dateYmd)
      .sort((a, b) => {
        const aPrimary = a.taskId.endsWith(`-${defaultRunId}`) ? 0 : 1;
        const bPrimary = b.taskId.endsWith(`-${defaultRunId}`) ? 0 : 1;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        return a.taskId.localeCompare(b.taskId);
      })
      .map((r) => toTaskSummaryDto(r.task));
  }

  function getPrimaryForDate(dateYmd: string): TaskSummaryDto | null {
    const tasks = listTasksForDate(dateYmd);
    return tasks[0] ?? null;
  }

  function listDays(fromYmd: string, toYmd: string): DaySummaryDto[] {
    if (compareYmd(fromYmd, toYmd) > 0) {
      throw new Error("`from` must be on or before `to`");
    }

    const byDate = new Map<string, TaskRecord[]>();
    for (const record of listAll()) {
      if (!record.dateYmd || !isYmdInRange(record.dateYmd, fromYmd, toYmd)) continue;
      const bucket = byDate.get(record.dateYmd) ?? [];
      bucket.push(record);
      byDate.set(record.dateYmd, bucket);
    }

    const days: DaySummaryDto[] = [];
    for (const [dateYmd, records] of byDate.entries()) {
      records.sort((a, b) => {
        const aPrimary = a.taskId.endsWith(`-${defaultRunId}`) ? 0 : 1;
        const bPrimary = b.taskId.endsWith(`-${defaultRunId}`) ? 0 : 1;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        return a.taskId.localeCompare(b.taskId);
      });

      const primary = toTaskSummaryDto(records[0]!.task);
      const day = toDaySummaryDto(primary, dateYmd);
      day.task_ids = records.map((r) => r.taskId);
      days.push(day);
    }

    days.sort((a, b) => b.date.localeCompare(a.date));
    return days;
  }

  function resolveDateYmd(input?: string): string {
    if (!input?.trim()) return todayYmdJst();
    return parseToYmd(input);
  }

  function listPendingPublishReview(): TaskSummaryDto[] {
    return listAll()
      .filter((r) => {
        const status = typeof r.task.status === "string" ? r.task.status : "";
        return status === "awaiting_publish_review" || status === "revising_copy";
      })
      .sort((a, b) => b.taskId.localeCompare(a.taskId))
      .map((r) => toTaskSummaryDto(r.task));
  }

  return {
    listAll,
    getById,
    getPrimaryForDate,
    listTasksForDate,
    listDays,
    listPendingPublishReview,
    resolveDateYmd,
    todayYmdJst,
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
