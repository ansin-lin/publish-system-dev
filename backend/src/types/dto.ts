export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "partial_failed"
  | "init_failed";

export type UiStepStatus = StepStatus | "waiting_human";

export type StepDto = {
  status: StepStatus;
  started_at?: string;
  finished_at?: string;
  input_ref?: string;
  output_ref?: string;
  message_ts?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
};

export type UiStepDto = {
  index: number;
  key: string;
  label: string;
  status: UiStepStatus;
};

export type TaskProgressDto = {
  percent: number;
  current_step: number;
  label: string;
};

export type TaskSummaryDto = {
  task_id: string;
  run_id: string;
  status: string;
  revision: number;
  degraded: boolean;
  created_at: string;
  updated_at: string;
  steps: {
    collect?: StepDto;
    tidy?: StepDto;
    approval?: StepDto;
    approve?: StepDto;
    research?: StepDto;
    copy?: StepDto;
    image?: StepDto;
    publish?: StepDto;
  };
  ui_steps: UiStepDto[];
  orchestrator_meta?: {
    last_event_id?: string;
    last_dispatcher_id?: string;
    last_dispatched_at?: string;
  };
  progress: TaskProgressDto;
  needs_human: boolean;
  is_terminal: boolean;
};

export type DaySummaryDto = {
  date: string;
  task_ids: string[];
  primary_task_id: string;
  status: string;
  step_summary: Record<string, StepStatus | "waiting_human">;
  updated_at: string;
  is_terminal: boolean;
  needs_human: boolean;
};

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

export type OutboxEventDto = {
  event_id: string;
  event_type: string;
  task_id: string;
  run_id: string;
  revision: number;
  status: string;
  retry_count: number;
  created_at: string;
  processed_at: string | null;
};

export type OutboxListDto = {
  events: OutboxEventDto[];
  counts: Record<string, number>;
};

export type CronJobDto = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  last_run_at: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  consecutive_errors: number;
  recent_runs: Array<{
    at: string;
    status: string;
    duration_ms: number | null;
    summary: string | null;
  }>;
};

export type CronStatusDto = {
  jobs: CronJobDto[];
};

export type DispatchLogRunDto = {
  started_at: string;
  finished_at: string | null;
  outcome: "ok" | "fail" | "running";
  exit_code?: number;
  ensure_daily_action?: string;
  task_id?: string;
  dispatch_claimed?: number;
  dispatch_done?: number;
  dispatch_failed?: number;
};

export type DispatchLogDto = {
  date: string;
  log_path: string;
  exists: boolean;
  runs: DispatchLogRunDto[];
};
