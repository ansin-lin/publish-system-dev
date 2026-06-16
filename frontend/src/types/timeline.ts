export type TimelineEventKind = "history" | "step_boundary" | "outbox" | "system_log";

export type TimelineEventDto = {
  id: string;
  at: string;
  kind: TimelineEventKind;
  title: string;
  operator?: string;
  step?: string;
  revision?: number;
  status?: string;
  detail?: Record<string, unknown>;
};

export type TimelineDto = {
  task_id: string;
  events: TimelineEventDto[];
};
