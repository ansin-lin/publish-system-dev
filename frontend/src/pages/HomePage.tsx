import { useParams } from "react-router-dom";
import { useDailyTasks } from "../api/hooks/useDailyTasks";
import { useRecentDays } from "../api/hooks/useRecentDays";
import { fetchHealth } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import { DatePicker } from "../components/common/DatePicker";
import { SystemHealthBar } from "../components/system/SystemHealthBar";
import { DailyTaskCard } from "../components/task/DailyTaskCard";
import { PendingPublishReviewBanner } from "../components/task/PendingPublishReviewBanner";
import { formatDateLabel, todayIsoDateJst } from "../utils/formatJst";

export function HomePage() {
  const { date: routeDate } = useParams<{ date?: string }>();
  const displayDate = routeDate ?? todayIsoDateJst();

  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  const daily = useDailyTasks(routeDate);
  const recentDays = useRecentDays();
  const recentDates = recentDays.data?.days.map((d) => d.date) ?? [];

  return (
    <div className="space-y-6">
      <SystemHealthBar />

      <PendingPublishReviewBanner />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">每日任务总览</h1>
          <p className="mt-1 text-slate-600">
            {formatDateLabel(displayDate)}（JST）
            {daily.isSuccess && daily.data.tasks.length > 0 && (
              <span className="ml-2 text-slate-500">· {daily.data.tasks.length} 个任务</span>
            )}
          </p>
        </div>
        <DatePicker recentDates={recentDates} />
      </div>

      {health.isSuccess && (
        <span className="block text-sm text-slate-500">API · {health.data.instance_name}</span>
      )}

      {daily.isLoading && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">加载任务中…</div>
      )}

      {daily.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          加载失败：{daily.error instanceof Error ? daily.error.message : "未知错误"}
        </div>
      )}

      {daily.isSuccess && daily.data.tasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-lg font-medium text-slate-800">当日暂无任务</p>
          <p className="mt-2 text-sm text-slate-600">
            通常于每日 09:00 JST 由 cron 创建 <code className="rounded bg-slate-100 px-1">daily-YYYYMMDD-r01</code>
          </p>
        </div>
      )}

      {daily.isSuccess && daily.data.tasks.length > 0 && (
        <>
          <p className="text-xs text-slate-500">
            上次更新：{new Date(daily.dataUpdatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            · 60s 自动刷新
          </p>
          <div className="space-y-4">
            {daily.data.tasks.map((task) => (
              <DailyTaskCard key={task.task_id} task={task} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
