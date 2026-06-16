import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPendingPublishReview } from "../../api/client";

export function PendingPublishReviewBanner() {
  const query = useQuery({
    queryKey: ["pending-publish-review"],
    queryFn: fetchPendingPublishReview,
    refetchInterval: 15_000,
  });

  const tasks = query.data?.tasks ?? [];
  if (!tasks.length) return null;

  return (
    <div className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-4 text-violet-950">
      <p className="font-semibold">待发布确认（{tasks.length}）</p>
      <p className="mt-1 text-sm text-violet-800">
        以下任务已完成文案与配图，需在详情页确认后才会进入 Step7 发布。
      </p>
      <ul className="mt-3 space-y-2">
        {tasks.map((task) => (
          <li key={task.task_id}>
            <Link
              to={`/task/${encodeURIComponent(task.task_id)}`}
              className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800"
            >
              打开确认面板 · {task.task_id}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
