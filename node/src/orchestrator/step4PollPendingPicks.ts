import type { OrchestratorSettings } from "./types.js";
import { listTaskJsonPaths, loadTaskJson } from "./taskStore.js";
import { loadPublishOrchestratorConfig } from "./publishOrchestratorConfig.js";
import { pollTaskSlackPick, type PollTaskPickResult } from "../step4-approval/slackPickHandler.js";
import { appendStep4SlackLog } from "../step4-approval/step4SlackLog.js";

export type Step4PollPendingPicksResult = {
  scanned: number;
  awaiting: number;
  polled: number;
  picks_applied: number;
  pick_errors: number;
  timeouts: number;
  skipped: number;
  results: Array<{ task_id: string; result: PollTaskPickResult }>;
};

/**
 * After dispatch-once: poll Slack threads for manager pick on awaiting tasks.
 * Does not affect run-once exit code (errors are logged only).
 */
export async function step4PollPendingPicks(
  settings: OrchestratorSettings,
): Promise<Step4PollPendingPicksResult> {
  const cfg = loadPublishOrchestratorConfig();
  const out: Step4PollPendingPicksResult = {
    scanned: 0,
    awaiting: 0,
    polled: 0,
    picks_applied: 0,
    pick_errors: 0,
    timeouts: 0,
    skipped: 0,
    results: [],
  };

  if (cfg.slack.step4.pick_receive.mode !== "poll") {
    return out;
  }
  if (cfg.slack.step4.pick_receive.poll_on !== "run-once") {
    return out;
  }

  for (const tpath of listTaskJsonPaths(settings)) {
    out.scanned += 1;
    const task = loadTaskJson(tpath);
    const status = typeof task.status === "string" ? task.status : "";
    if (status !== "awaiting_manager_selection") continue;
    out.awaiting += 1;

    const taskId = typeof task.task_id === "string" ? task.task_id : pathBasename(tpath);
    const result = await pollTaskSlackPick(tpath, settings);
    out.results.push({ task_id: taskId, result });

    if (result.outcome === "skipped") {
      out.skipped += 1;
      continue;
    }
    if (result.outcome === "no_new_messages") continue;

    out.polled += 1;
    if (result.outcome === "pick_applied") out.picks_applied += 1;
    else if (result.outcome === "pick_error") out.pick_errors += 1;
    else if (result.outcome === "timeout") out.timeouts += 1;
    else if (result.outcome === "poll_error") {
      appendStep4SlackLog("poll_task_error", { task_id: taskId, error: result.error });
    }
  }

  if (out.polled > 0 || out.picks_applied > 0) {
    appendStep4SlackLog("poll_batch_done", {
      awaiting: out.awaiting,
      picks_applied: out.picks_applied,
      pick_errors: out.pick_errors,
      timeouts: out.timeouts,
    });
  }

  return out;
}

function pathBasename(tpath: string): string {
  const parts = tpath.replace(/\\/g, "/").split("/");
  const idx = parts.lastIndexOf("task.json");
  return idx > 0 ? (parts[idx - 1] ?? "unknown") : "unknown";
}
