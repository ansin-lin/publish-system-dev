import { Link } from "react-router-dom";
import { useOutboxSummary } from "../../api/hooks/useOutbox";

export function SystemHealthBar() {
  const outbox = useOutboxSummary();

  if (outbox.isLoading || outbox.isError || !outbox.data) return null;

  const { pending = 0, processing = 0, failed = 0 } = outbox.data.counts;
  const alert = failed > 0 || pending > 5;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${
        alert ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap gap-4 text-slate-700">
        <span>
          Outbox pending: <strong>{pending}</strong>
        </span>
        <span>
          processing: <strong>{processing}</strong>
        </span>
        <span className={failed > 0 ? "text-red-700" : ""}>
          failed: <strong>{failed}</strong>
        </span>
      </div>
      <Link to="/system" className="font-medium text-blue-600 hover:underline">
        运维详情 →
      </Link>
    </div>
  );
}
