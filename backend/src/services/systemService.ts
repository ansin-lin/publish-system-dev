import fs from "node:fs";
import path from "node:path";
import { loadOrchestratorSettings } from "../../../node/src/orchestrator/config.js";
import type { OrchestratorSettings } from "../../../node/src/orchestrator/types.js";
import type { DashboardConfig } from "../config/dashboardConfig.js";
import { loadDashboardConfig } from "../config/dashboardConfig.js";
import type { CronJobDto, CronStatusDto, DispatchLogDto, DispatchLogRunDto } from "../types/dto.js";
import { parseToYmd } from "../utils/dateJst.js";

const LOG_LINE_RE = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatSchedule(job: Record<string, unknown>): string {
  const schedule = job.schedule;
  if (!isObject(schedule)) return "unknown";
  if (schedule.kind === "cron" && typeof schedule.expr === "string") {
    const tz = typeof schedule.tz === "string" ? schedule.tz : "UTC";
    return `cron ${schedule.expr} (${tz})`;
  }
  if (schedule.kind === "every" && typeof schedule.everyMs === "number") {
    return `every ${Math.round(schedule.everyMs / 1000)}s`;
  }
  return JSON.stringify(schedule);
}

function msToIsoJst(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const offsetMs = 9 * 60 * 60 * 1000;
  return `${new Date(ms + offsetMs).toISOString().slice(0, 19)}+09:00`;
}

function readRecentCronRuns(cronRunsDir: string, jobId: string, limit = 5): CronJobDto["recent_runs"] {
  const filePath = path.join(cronRunsDir, `${jobId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-limit);

  return tail
    .map((line) => {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const ts = typeof row.ts === "number" ? row.ts : typeof row.runAtMs === "number" ? row.runAtMs : null;
        return {
          at: ts ? msToIsoJst(ts) ?? String(ts) : "",
          status: typeof row.status === "string" ? row.status : typeof row.lastRunStatus === "string" ? row.lastRunStatus : "unknown",
          duration_ms: typeof row.durationMs === "number" ? row.durationMs : null,
          summary: typeof row.summary === "string" ? row.summary : null,
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .reverse();
}

function parseDispatchJsonBlock(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseDispatchLog(content: string): DispatchLogRunDto[] {
  const runs: DispatchLogRunDto[] = [];
  let current: DispatchLogRunDto | null = null;
  let runMessages: string[] = [];

  const finishRun = (at: string, outcome: "ok" | "fail", exitCode?: number) => {
    if (!current) return;
    const parsed = parseDispatchJsonBlock(runMessages.join("\n"));
    if (parsed) {
      const ensureDaily = isObject(parsed.ensure_daily) ? parsed.ensure_daily : null;
      const dispatch = isObject(parsed.dispatch) ? parsed.dispatch : null;
      if (ensureDaily) {
        if (typeof ensureDaily.action === "string") current.ensure_daily_action = ensureDaily.action;
        if (typeof ensureDaily.taskId === "string") current.task_id = ensureDaily.taskId;
      }
      if (dispatch) {
        if (typeof dispatch.claimed === "number") current.dispatch_claimed = dispatch.claimed;
        if (typeof dispatch.done === "number") current.dispatch_done = dispatch.done;
        if (typeof dispatch.failed === "number") current.dispatch_failed = dispatch.failed;
      }
    }
    current.finished_at = at;
    current.outcome = outcome;
    if (exitCode !== undefined) current.exit_code = exitCode;
    runs.push(current);
    current = null;
    runMessages = [];
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const m = rawLine.match(LOG_LINE_RE);
    if (!m) continue;
    const at = m[1]!;
    const msg = m[2]!;

    if (msg === "START dispatch-run-once") {
      if (current) runs.push(current);
      current = { started_at: at, finished_at: null, outcome: "running" };
      runMessages = [];
      continue;
    }

    if (!current) continue;

    if (msg.startsWith("OK run-once finished")) {
      finishRun(at, "ok");
      continue;
    }

    if (msg.startsWith("FAIL run-once exit=")) {
      const exitMatch = msg.match(/exit=(\d+)/);
      finishRun(at, "fail", exitMatch ? Number(exitMatch[1]) : undefined);
      continue;
    }

    if (msg.startsWith("{") || msg.includes('"') || runMessages.length > 0) {
      runMessages.push(msg);
    }
  }

  if (current) runs.push(current);
  return runs.reverse();
}

export function createSystemService(
  dashboardConfig: DashboardConfig = loadDashboardConfig(),
  settings: OrchestratorSettings = loadOrchestratorSettings(),
) {
  const cronJobsPath = path.join(dashboardConfig.openclawRoot, "cron", "jobs.json");
  const cronRunsDir = path.join(dashboardConfig.openclawRoot, "cron", "runs");
  const logsDir = settings.logsDir;

  return {
    getCronStatus(): CronStatusDto {
      if (!fs.existsSync(cronJobsPath)) return { jobs: [] };

      const raw = JSON.parse(fs.readFileSync(cronJobsPath, "utf-8")) as Record<string, unknown>;
      const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];

      const publishJobs: CronJobDto[] = jobs
        .filter((job): job is Record<string, unknown> => isObject(job))
        .filter((job) => {
          const name = typeof job.name === "string" ? job.name : "";
          return name.startsWith("publish-");
        })
        .map((job) => {
          const state = isObject(job.state) ? job.state : {};
          const id = typeof job.id === "string" ? job.id : "";
          return {
            id,
            name: typeof job.name === "string" ? job.name : id,
            enabled: job.enabled !== false,
            schedule: formatSchedule(job),
            last_run_at: msToIsoJst(typeof state.lastRunAtMs === "number" ? state.lastRunAtMs : undefined),
            last_status:
              typeof state.lastRunStatus === "string"
                ? state.lastRunStatus
                : typeof state.lastStatus === "string"
                  ? state.lastStatus
                  : null,
            last_duration_ms: typeof state.lastDurationMs === "number" ? state.lastDurationMs : null,
            consecutive_errors: typeof state.consecutiveErrors === "number" ? state.consecutiveErrors : 0,
            recent_runs: id ? readRecentCronRuns(cronRunsDir, id) : [],
          };
        });

      return { jobs: publishJobs };
    },

    getDispatchLog(dateInput?: string): DispatchLogDto {
      const ymd = dateInput ? parseToYmd(dateInput) : parseToYmd(new Date().toISOString().slice(0, 10));
      const logPath = path.resolve(logsDir, `cron-dispatch-${ymd}.log`);
      const exists = fs.existsSync(logPath);

      if (!exists) {
        return {
          date: ymd,
          log_path: logPath,
          exists: false,
          runs: [],
        };
      }

      const content = fs.readFileSync(logPath, "utf-8");
      const runs = parseDispatchLog(content).slice(0, 100);

      return {
        date: ymd,
        log_path: logPath,
        exists: true,
        runs,
      };
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
