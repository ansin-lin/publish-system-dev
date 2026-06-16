import type { TimelineEventKind } from "../types/timeline";

export function timelineKindLabel(kind: TimelineEventKind): string {
  switch (kind) {
    case "history":
      return "审计";
    case "step_boundary":
      return "步骤";
    case "outbox":
      return "调度";
    case "system_log":
      return "系统";
    default:
      return kind;
  }
}

export function timelineKindDotClass(kind: TimelineEventKind): string {
  switch (kind) {
    case "history":
      return "bg-slate-500";
    case "step_boundary":
      return "bg-blue-500";
    case "outbox":
      return "bg-violet-500";
    case "system_log":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

export function timelineKindBadgeClass(kind: TimelineEventKind): string {
  switch (kind) {
    case "history":
      return "bg-slate-100 text-slate-700";
    case "step_boundary":
      return "bg-blue-100 text-blue-700";
    case "outbox":
      return "bg-violet-100 text-violet-700";
    case "system_log":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}
