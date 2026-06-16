import { useState } from "react";
import type { TimelineEventDto } from "../../types/timeline";
import { formatJst } from "../../utils/formatJst";
import { timelineKindBadgeClass, timelineKindDotClass, timelineKindLabel } from "../../utils/timelineKind";

type Props = {
  event: TimelineEventDto;
};

export function TimelineItem({ event }: Props) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(event.detail && Object.keys(event.detail).length > 0);

  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      <div className="flex flex-col items-center">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${timelineKindDotClass(event.kind)}`} />
        <span className="mt-2 w-px flex-1 bg-slate-200" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${timelineKindBadgeClass(event.kind)}`}>
            {timelineKindLabel(event.kind)}
          </span>
          <time className="font-mono text-xs text-slate-500">{formatJst(event.at)}</time>
          {event.step && <span className="text-xs text-slate-500">· {event.step}</span>}
          {event.revision !== undefined && (
            <span className="text-xs text-slate-500">· rev {event.revision}</span>
          )}
          {event.status && <span className="text-xs text-slate-500">· {event.status}</span>}
        </div>

        <p className="mt-1 font-medium text-slate-900">{event.title}</p>

        {event.operator && <p className="mt-0.5 text-sm text-slate-600">operator: {event.operator}</p>}

        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-xs text-blue-600 hover:underline"
          >
            {open ? "收起详情" : "展开详情"}
          </button>
        )}

        {open && hasDetail && (
          <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
            {JSON.stringify(event.detail, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}
