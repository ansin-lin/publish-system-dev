import { useState } from "react";
import { Link } from "react-router-dom";
import { useOutboxFiltered } from "../api/hooks/useOutbox";
import { useCronStatus, useDispatchLog } from "../api/hooks/useSystem";
import { CronJobsTable } from "../components/system/CronJobsTable";
import { DispatchLogViewer } from "../components/system/DispatchLogViewer";
import { OutboxQueueTable } from "../components/system/OutboxQueueTable";
import { todayIsoDateJst } from "../utils/formatJst";

export function SystemPage() {
  const [statusFilter, setStatusFilter] = useState("pending,failed");
  const [taskFilter, setTaskFilter] = useState("");

  const outbox = useOutboxFiltered(statusFilter || undefined, taskFilter || undefined);
  const cron = useCronStatus();
  const dispatch = useDispatchLog(todayIsoDateJst().replace(/-/g, ""));

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          ← 返回总览
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">系统运维</h1>
        <p className="mt-1 text-slate-600">Outbox 队列、Cron 任务与 dispatch 日志</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">Outbox 队列</h2>
        {outbox.isLoading && <p className="text-sm text-slate-600">加载中…</p>}
        {outbox.isError && (
          <p className="text-sm text-red-700">{outbox.error instanceof Error ? outbox.error.message : "加载失败"}</p>
        )}
        {outbox.isSuccess && (
          <OutboxQueueTable
            events={outbox.data.events}
            counts={outbox.data.counts}
            taskFilter={taskFilter}
            statusFilter={statusFilter}
            onTaskFilterChange={setTaskFilter}
            onStatusFilterChange={setStatusFilter}
          />
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">Cron 任务</h2>
        {cron.isLoading && <p className="text-sm text-slate-600">加载中…</p>}
        {cron.isSuccess && <CronJobsTable jobs={cron.data.jobs} />}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-slate-500">今日 Dispatch 日志</h2>
        {dispatch.isLoading && <p className="text-sm text-slate-600">加载中…</p>}
        {dispatch.isSuccess && (
          <DispatchLogViewer runs={dispatch.data.runs} exists={dispatch.data.exists} logPath={dispatch.data.log_path} />
        )}
      </section>
    </div>
  );
}
