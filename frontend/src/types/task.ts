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
  step_summary: Record<string, UiStepStatus>;
  updated_at: string;
  is_terminal: boolean;
  needs_human: boolean;
};

export type PrimaryDayResponse = {
  date: string;
  task: TaskSummaryDto | null;
};

export type DaysResponse = {
  days: DaySummaryDto[];
};
