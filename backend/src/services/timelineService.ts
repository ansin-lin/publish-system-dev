import type { JsonObject } from "../../../node/src/step2-collect/types.js";
import { createOutboxRepo } from "../../../node/src/orchestrator/outboxRepo.js";
import { loadTaskJson, taskJsonPath } from "../../../node/src/orchestrator/taskStore.js";
import { parseIsoJstMs } from "../../../node/src/orchestrator/time.js";
import type { OrchestratorSettings, OutboxEvent } from "../../../node/src/orchestrator/types.js";
import { loadOrchestratorSettings } from "../../../node/src/orchestrator/config.js";
import type { TimelineDto, TimelineEventDto } from "../types/dto.js";

const STEP_KEYS = ["collect", "tidy", "approval", "approve", "research", "copy", "image", "publish"] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortKey(at: string): number {
  return parseIsoJstMs(at) ?? Number.MAX_SAFE_INTEGER;
}

function dedupeHistoryEvents(events: TimelineEventDto[]): TimelineEventDto[] {
  const out: TimelineEventDto[] = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === "history" &&
      event.kind === "history" &&
      prev.at === event.at &&
      prev.title === event.title &&
      prev.operator === event.operator
    ) {
      continue;
    }
    out.push(event);
  }
  return out;
}

function historyEvents(task: JsonObject): TimelineEventDto[] {
  const history = task.history;
  if (!Array.isArray(history)) return [];

  const events: TimelineEventDto[] = [];
  history.forEach((entry, index) => {
    if (!isObject(entry)) return;
    const at = typeof entry.at === "string" ? entry.at : "";
    const title = typeof entry.event === "string" ? entry.event : "unknown_event";
    if (!at) return;

    const dto: TimelineEventDto = {
      id: `hist-${index}`,
      at,
      kind: "history",
      title,
    };
    if (typeof entry.operator === "string") dto.operator = entry.operator;
    if (isObject(entry.data) && Object.keys(entry.data).length > 0) {
      dto.detail = entry.data as Record<string, unknown>;
    }
    events.push(dto);
  });

  return dedupeHistoryEvents(events);
}

function stepBoundaryEvents(steps: unknown): TimelineEventDto[] {
  if (!isObject(steps)) return [];
  const events: TimelineEventDto[] = [];

  for (const step of STEP_KEYS) {
    const raw = steps[step];
    if (!isObject(raw)) continue;

    if (typeof raw.started_at === "string" && raw.started_at.trim()) {
      events.push({
        id: `step-${step}-started`,
        at: raw.started_at,
        kind: "step_boundary",
        title: `${step}.started`,
        step,
      });
    }
    if (typeof raw.finished_at === "string" && raw.finished_at.trim()) {
      events.push({
        id: `step-${step}-finished`,
        at: raw.finished_at,
        kind: "step_boundary",
        title: `${step}.finished`,
        step,
        ...(isObject(raw.error) && typeof raw.error.message === "string"
          ? { detail: { error: raw.error.message as string } }
          : {}),
      });
    }
  }

  return events;
}

function outboxEvents(rows: OutboxEvent[]): TimelineEventDto[] {
  const seenRevision = new Set<string>();
  const events: TimelineEventDto[] = [];

  for (const row of rows) {
    const dedupeKey = `${row.event_type}:${row.revision}:${row.status}`;
    if (row.event_type === "TASK_UPDATED" && seenRevision.has(dedupeKey)) continue;
    if (row.event_type === "TASK_UPDATED") seenRevision.add(dedupeKey);

    events.push({
      id: `outbox-${row.event_id}`,
      at: row.created_at,
      kind: "outbox",
      title: row.event_type,
      revision: row.revision,
      status: row.status,
    });
  }

  return events;
}

export function buildTimeline(task: JsonObject, outboxRows: OutboxEvent[]): TimelineDto {
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const merged = [
    ...historyEvents(task),
    ...stepBoundaryEvents(task.steps),
    ...outboxEvents(outboxRows),
  ];

  merged.sort((a, b) => {
    const diff = sortKey(a.at) - sortKey(b.at);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  return { task_id: taskId, events: merged };
}

export function createTimelineService(settings: OrchestratorSettings = loadOrchestratorSettings()) {
  const outboxRepo = createOutboxRepo(settings);

  return {
    getTimeline(taskId: string): TimelineDto | null {
      const jsonPath = taskJsonPath(settings, taskId);
      try {
        const task = loadTaskJson(jsonPath) as JsonObject;
        const runId = typeof task.run_id === "string" ? task.run_id : undefined;
        const rows = outboxRepo.listByTaskId(taskId, runId);
        return buildTimeline(task, rows);
      } catch {
        return null;
      }
    },
  };
}

export type TimelineService = ReturnType<typeof createTimelineService>;
