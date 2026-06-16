const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created: ["collecting", "cancelled", "failed"],
  collecting: ["collected", "failed", "aborted", "cancelled"],
  collected: ["awaiting_manager_selection", "failed", "aborted", "cancelled"],
  analyzing: ["collected", "analyzed", "failed", "aborted", "cancelled"],
  analyzed: ["awaiting_manager_selection", "failed", "aborted", "cancelled", "analyzing", "collected"],
  awaiting_manager_selection: ["topics_selected", "manager_selected", "approval_timeout", "failed", "aborted", "cancelled"],
  topics_selected: ["generating_research", "manager_selected", "failed", "aborted", "cancelled"],
  generating_research: ["research_done", "topics_selected", "manager_selected", "failed", "aborted", "cancelled"],
  research_done: ["generating_copy", "manager_selected", "failed", "aborted", "cancelled"],
  manager_selected: ["generating_copy", "generating_research", "research_done", "deep_collecting", "failed", "aborted", "cancelled"],
  deep_collecting: ["deep_collected", "failed", "aborted", "cancelled"],
  deep_collected: ["generating_copy", "failed", "aborted", "cancelled"],
  generating_copy: ["copy_generated", "research_done", "manager_selected", "failed", "aborted", "cancelled"],
  copy_generated: ["generating_image", "failed", "aborted", "cancelled"],
  generating_image: ["image_generated", "awaiting_publish_review", "copy_generated", "failed", "aborted", "cancelled"],
  image_generated: ["publishing", "awaiting_publish_review", "failed", "aborted", "cancelled"],
  awaiting_publish_review: ["image_generated", "revising_copy", "cancelled", "failed", "aborted"],
  revising_copy: ["awaiting_publish_review", "cancelled", "failed", "aborted"],
  publishing: ["published", "publish_partial_failed", "failed", "aborted", "cancelled"],
  publish_partial_failed: ["publishing", "image_generated", "failed", "aborted", "cancelled"],
};

export function assertValidTransition(previousStatus: unknown, nextStatus: unknown): void {
  if (typeof previousStatus !== "string" || typeof nextStatus !== "string") return;
  if (previousStatus === nextStatus) return;
  const allowed = ALLOWED_TRANSITIONS[previousStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Illegal task.status transition: ${previousStatus} -> ${nextStatus}`);
  }
}
