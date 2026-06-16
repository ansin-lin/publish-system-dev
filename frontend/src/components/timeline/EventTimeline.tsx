import type { TimelineEventDto } from "../../types/timeline";
import { TimelineItem } from "./TimelineItem";

type Props = {
  events: TimelineEventDto[];
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  dataUpdatedAt?: number;
};

export function EventTimeline({ events, isLoading, isError, errorMessage, dataUpdatedAt }: Props) {
  if (isLoading) {
    return <p className="text-sm text-slate-600">加载时间线…</p>;
  }

  if (isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {errorMessage ?? "时间线加载失败"}
      </div>
    );
  }

  if (!events.length) {
    return <p className="text-sm text-slate-500">暂无流程记录。</p>;
  }

  const displayEvents = [...events].reverse();

  return (
    <div>
      {dataUpdatedAt !== undefined && (
        <p className="mb-4 text-xs text-slate-500">
          上次更新：{new Date(dataUpdatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          · 60s 自动刷新
        </p>
      )}
      <ol className="pl-1">
        {displayEvents.map((event) => (
          <TimelineItem key={event.id} event={event} />
        ))}
      </ol>
    </div>
  );
}
