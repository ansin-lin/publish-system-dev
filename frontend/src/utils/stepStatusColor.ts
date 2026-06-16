import type { UiStepStatus } from "../types/task";

export function isStepClickable(status: UiStepStatus): boolean {
  return status !== "pending" && status !== "running";
}

export function stepStatusDotClass(status: UiStepStatus): string {
  switch (status) {
    case "success":
      return "bg-emerald-500";
    case "running":
      return "bg-blue-500 animate-pulse";
    case "waiting_human":
      return "bg-amber-500";
    case "failed":
    case "init_failed":
      return "bg-red-500";
    case "partial_failed":
      return "bg-orange-500";
    default:
      return "bg-slate-300";
  }
}

export function stepStatusTextClass(status: UiStepStatus): string {
  switch (status) {
    case "success":
      return "text-emerald-700";
    case "running":
      return "text-blue-700";
    case "waiting_human":
      return "text-amber-700";
    case "failed":
    case "init_failed":
      return "text-red-700";
    case "partial_failed":
      return "text-orange-700";
    default:
      return "text-slate-500";
  }
}

export function stepStatusLabel(status: UiStepStatus): string {
  switch (status) {
    case "success":
      return "完成";
    case "running":
      return "进行中";
    case "waiting_human":
      return "等待人工";
    case "failed":
      return "失败";
    case "init_failed":
      return "初始化失败";
    case "partial_failed":
      return "部分失败";
    default:
      return "待开始";
  }
}

export function taskStatusBadgeClass(status: string): string {
  if (status === "published") return "bg-emerald-100 text-emerald-800";
  if (status === "awaiting_manager_selection") return "bg-amber-100 text-amber-800";
  if (["failed", "cancelled", "aborted", "approval_timeout"].includes(status)) {
    return "bg-red-100 text-red-800";
  }
  if (status === "publish_partial_failed") return "bg-orange-100 text-orange-800";
  if (status.startsWith("generating") || status === "collecting" || status === "publishing") {
    return "bg-blue-100 text-blue-800";
  }
  return "bg-slate-100 text-slate-800";
}
