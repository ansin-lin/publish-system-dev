import type { TaskSummaryDto } from "../../types/task";

type Props = {
  task: TaskSummaryDto;
};

export function HumanGateAlert({ task }: Props) {
  if (task.status === "awaiting_manager_selection") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
        <p className="font-medium">等待 Slack 选题</p>
        <p className="mt-1 text-sm">
          请在 Slack 频道回复 <code className="rounded bg-amber-100 px-1">pick 2,5,8</code>{" "}
          选择话题编号。
        </p>
      </div>
    );
  }

  if (task.status === "publish_partial_failed") {
    return (
      <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-orange-900">
        <p className="font-medium">部分平台发布失败</p>
        <p className="mt-1 text-sm">
          可在 Slack Step7 通知线程回复 <code className="rounded bg-orange-100 px-1">retry x</code>{" "}
          重试失败平台。
        </p>
      </div>
    );
  }

  return null;
}
