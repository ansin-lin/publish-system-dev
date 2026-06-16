import type { DispatchLogRunDto } from "../../types/system";
import { formatJst } from "../../utils/formatJst";

type Props = {
  runs: DispatchLogRunDto[];
  exists: boolean;
  logPath: string;
};

export function DispatchLogViewer({ runs, exists, logPath }: Props) {
  if (!exists) {
    return <p className="text-sm text-slate-500">当日 dispatch 日志不存在。</p>;
  }

  return (
    <div className="space-y-3">
      <p className="break-all font-mono text-xs text-slate-500">{logPath}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">开始</th>
              <th className="py-2 pr-3">结束</th>
              <th className="py-2 pr-3">结果</th>
              <th className="py-2 pr-3">ensure_daily</th>
              <th className="py-2 pr-3">dispatch</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 30).map((run, i) => (
              <tr key={`${run.started_at}-${i}`} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{formatJst(run.started_at)}</td>
                <td className="py-2 pr-3 font-mono text-xs">{formatJst(run.finished_at ?? undefined)}</td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      run.outcome === "ok"
                        ? "text-emerald-700"
                        : run.outcome === "fail"
                          ? "text-red-700"
                          : "text-blue-700"
                    }
                  >
                    {run.outcome}
                    {run.exit_code !== undefined ? ` (${run.exit_code})` : ""}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs">
                  {run.ensure_daily_action ?? "—"}
                  {run.task_id ? ` · ${run.task_id}` : ""}
                </td>
                <td className="py-2 text-xs">
                  {run.dispatch_claimed ?? "—"}/{run.dispatch_done ?? "—"}/{run.dispatch_failed ?? "—"}
                  <span className="text-slate-400"> (c/d/f)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runs.length > 30 && <p className="text-xs text-slate-500">仅显示最近 30 次 run-once</p>}
    </div>
  );
}
