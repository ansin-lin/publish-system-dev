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
