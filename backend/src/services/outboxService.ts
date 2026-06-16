import { createOutboxRepo } from "../../../node/src/orchestrator/outboxRepo.js";
import { loadOrchestratorSettings } from "../../../node/src/orchestrator/config.js";
import type { OrchestratorSettings, OutboxEventStatus } from "../../../node/src/orchestrator/types.js";
import type { OutboxEventDto, OutboxListDto } from "../types/dto.js";

const VALID_STATUSES = new Set<OutboxEventStatus>(["pending", "processing", "done", "failed"]);

function toDto(event: ReturnType<ReturnType<typeof createOutboxRepo>["listByFilter"]>[number]): OutboxEventDto {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    task_id: event.task_id,
    run_id: event.run_id,
    revision: event.revision,
    status: event.status,
    retry_count: event.retry_count,
    created_at: event.created_at,
    processed_at: event.processed_at ?? null,
  };
}

export function createOutboxService(settings: OrchestratorSettings = loadOrchestratorSettings()) {
  const repo = createOutboxRepo(settings);

  return {
    list(params: { status?: string; task_id?: string; limit?: number }): OutboxListDto {
      const statuses = params.status
        ?.split(",")
        .map((s) => s.trim())
        .filter((s): s is OutboxEventStatus => VALID_STATUSES.has(s as OutboxEventStatus));

      const events = repo.listByFilter({
        ...(statuses?.length ? { statuses } : {}),
        ...(params.task_id?.trim() ? { taskId: params.task_id.trim() } : {}),
        limit: params.limit ?? 100,
      });

      const counts = repo.countByStatus();
      return {
        events: events.map(toDto),
        counts,
      };
    },
  };
}

export type OutboxService = ReturnType<typeof createOutboxService>;
