import type { CronJobDto } from "../../types/system";
import { formatJst } from "../../utils/formatJst";

type Props = {
  jobs: CronJobDto[];
};

export function CronJobsTable({ jobs }: Props) {
  if (!jobs.length) {
    return <p className="text-sm text-slate-500">未找到 publish 相关 cron 任务。</p>;
  }

  return (
    <div className="space-y-6">
      {jobs.map((job) => (
        <div key={job.id} className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-medium text-slate-900">{job.name}</h3>
              <p className="text-sm text-slate-500">{job.schedule}</p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                job.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
              }`}
            >
              {job.enabled ? "enabled" : "disabled"}
            </span>
          </div>

          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">最近运行</dt>
              <dd className="font-mono text-xs">{formatJst(job.last_run_at ?? undefined)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">状态 / 耗时</dt>
              <dd>
                {job.last_status ?? "—"}
                {job.last_duration_ms != null ? ` · ${job.last_duration_ms}ms` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">连续错误</dt>
              <dd className={job.consecutive_errors > 0 ? "text-red-700" : ""}>{job.consecutive_errors}</dd>
            </div>
          </dl>

          {job.recent_runs.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">最近运行记录</p>
              <ul className="mt-2 space-y-2 text-sm">
                {job.recent_runs.map((run, i) => (
                  <li key={`${run.at}-${i}`} className="rounded bg-slate-50 px-2 py-1.5">
                    <span className="font-mono text-xs text-slate-500">{formatJst(run.at)}</span>
                    <span className="mx-2">{run.status}</span>
                    {run.duration_ms != null && <span className="text-slate-500">{run.duration_ms}ms</span>}
                    {run.summary && <p className="mt-1 text-slate-600 line-clamp-2">{run.summary}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
