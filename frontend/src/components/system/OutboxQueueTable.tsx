import { Link } from "react-router-dom";
import type { OutboxEventDto } from "../../types/system";
import { formatJst } from "../../utils/formatJst";

type Props = {
  events: OutboxEventDto[];
  counts: Record<string, number>;
  taskFilter: string;
  statusFilter: string;
  onTaskFilterChange: (v: string) => void;
  onStatusFilterChange: (v: string) => void;
};

export function OutboxQueueTable({
  events,
  counts,
  taskFilter,
  statusFilter,
  onTaskFilterChange,
  onStatusFilterChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm text-slate-600">
        {Object.entries(counts).map(([status, count]) => (
          <span key={status}>
            {status}: <strong>{count}</strong>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="task_id 筛选"
          value={taskFilter}
          onChange={(e) => onTaskFilterChange(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">全部状态</option>
          <option value="pending">pending</option>
          <option value="processing">processing</option>
          <option value="failed">failed</option>
          <option value="done">done</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">created_at</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">type</th>
              <th className="py-2 pr-3">task</th>
              <th className="py-2">rev</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-slate-500">
                  无匹配事件
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.event_id} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{formatJst(e.created_at)}</td>
                <td className="py-2 pr-3">{e.status}</td>
                <td className="py-2 pr-3">{e.event_type}</td>
                <td className="py-2 pr-3">
                  <Link to={`/task/${encodeURIComponent(e.task_id)}`} className="text-blue-600 hover:underline">
                    {e.task_id}
                  </Link>
                </td>
                <td className="py-2">{e.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
