import type { ArtifactFetchParams, ArtifactStep, ArtifactSummaryDto } from "../types/artifact";
import type { DaysResponse, PrimaryDayResponse, TaskSummaryDto } from "../types/task";
import type { CronStatusDto, DispatchLogDto, OutboxListDto } from "../types/system";
import type { TimelineDto } from "../types/timeline";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export type HealthResponse = {
  ok: boolean;
  instance_name: string;
  timezone: string;
  paths: {
    tasks_dir: string;
    db_path: string;
    tasks_dir_readable: boolean;
    db_readable: boolean;
    orchestrator_config: string;
    openclaw_root: string;
  };
  server_time: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T | ApiError;
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  return parseJson<HealthResponse>(res);
}

export async function fetchTask(taskId: string): Promise<TaskSummaryDto> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`);
  return parseJson<TaskSummaryDto>(res);
}

export async function fetchPendingPublishReview(): Promise<{ tasks: TaskSummaryDto[] }> {
  const res = await fetch(`${API_BASE}/tasks/pending-publish-review`);
  return parseJson<{ tasks: TaskSummaryDto[] }>(res);
}

export type DailyTasksResponse = {
  date: string;
  tasks: TaskSummaryDto[];
};

export async function fetchDailyTasks(date?: string): Promise<DailyTasksResponse> {
  const suffix = date ? `/${encodeURIComponent(date)}` : `/${todayYmdParam()}`;
  const res = await fetch(`${API_BASE}/days${suffix}/tasks`);
  return parseJson<DailyTasksResponse>(res);
}

export async function fetchPrimaryDay(date?: string): Promise<PrimaryDayResponse> {
  const suffix = date ? `/${encodeURIComponent(date)}` : `/${todayYmdParam()}`;
  const res = await fetch(`${API_BASE}/days${suffix}/primary`);
  return parseJson<PrimaryDayResponse>(res);
}

export async function fetchArtifact(
  taskId: string,
  step: ArtifactStep,
  params?: ArtifactFetchParams,
): Promise<ArtifactSummaryDto> {
  const search = new URLSearchParams();
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  if (params?.offset !== undefined) search.set("offset", String(params.offset));
  if (params?.section) search.set("section", params.section);
  const qs = search.toString();
  const res = await fetch(
    `${API_BASE}/tasks/${encodeURIComponent(taskId)}/artifacts/${step}${qs ? `?${qs}` : ""}`,
  );
  return parseJson<ArtifactSummaryDto>(res);
}

export async function fetchTaskTimeline(taskId: string): Promise<TimelineDto> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/timeline`);
  return parseJson<TimelineDto>(res);
}

export async function fetchDays(from?: string, to?: string): Promise<DaysResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/days${qs ? `?${qs}` : ""}`);
  return parseJson<DaysResponse>(res);
}

export async function fetchOutbox(params?: {
  status?: string;
  task_id?: string;
  limit?: number;
}): Promise<OutboxListDto> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.task_id) search.set("task_id", params.task_id);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await fetch(`${API_BASE}/outbox${qs ? `?${qs}` : ""}`);
  return parseJson<OutboxListDto>(res);
}

export async function fetchCronStatus(): Promise<CronStatusDto> {
  const res = await fetch(`${API_BASE}/system/cron`);
  return parseJson<CronStatusDto>(res);
}

export type PublishReviewDraftRow = {
  platform: string;
  locale: string;
  title: string;
  body: string;
  tags: string[];
  topic_title?: string;
};

export type PublishReviewContext = {
  enabled: boolean;
  task_status: string;
  revision_count: number;
  max_revisions: number;
  can_regenerate: boolean;
  regenerate_blocked_reason?: string;
  copy_review_status: string;
  last_error?: string;
  last_error_kind?: "constraint" | "other";
  last_regenerated_platforms?: string[];
  last_regenerated_at?: string;
  drafts: PublishReviewDraftRow[];
  image_count: number;
};

export async function fetchPublishReview(taskId: string): Promise<PublishReviewContext> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/publish-review`);
  return parseJson<PublishReviewContext>(res);
}

export async function approvePublishReview(
  taskId: string,
  action: "approve" | "reject",
): Promise<{ ok: boolean; task_status: string }> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/approve-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return parseJson(res);
}

export async function regenerateCopyPlatforms(
  taskId: string,
  body: { platforms: string[]; feedback: string },
): Promise<{ ok: boolean; merged_platforms: string[]; revision_count: number }> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/regenerate-copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function fetchDispatchLog(date?: string): Promise<DispatchLogDto> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await fetch(`${API_BASE}/system/dispatch-log${qs}`);
  return parseJson<DispatchLogDto>(res);
}

function todayYmdParam(): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10).replace(/-/g, "");
}
