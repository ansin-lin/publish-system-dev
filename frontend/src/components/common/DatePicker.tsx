import { useNavigate, useParams } from "react-router-dom";
import { todayIsoDateJst } from "../../utils/formatJst";

type Props = {
  recentDates?: string[];
};

export function DatePicker({ recentDates = [] }: Props) {
  const navigate = useNavigate();
  const { date: routeDate } = useParams<{ date?: string }>();
  const value = routeDate ?? todayIsoDateJst();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm text-slate-600" htmlFor="day-picker">
        日期
      </label>
      <input
        id="day-picker"
        type="date"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (!next) return;
          if (next === todayIsoDateJst()) navigate("/");
          else navigate(`/day/${next}`);
        }}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      />
      {recentDates.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {recentDates.slice(0, 7).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => (d === todayIsoDateJst() ? navigate("/") : navigate(`/day/${d}`))}
              className={`rounded px-2 py-0.5 text-xs ${
                d === value ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {d.slice(5)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
