import { randomUUID } from "node:crypto";
import { loadOrchestratorSettings } from "./config.js";
import { createOutboxRepo } from "./outboxRepo.js";
import { reconcileStaleSteps, type ReconcileStaleStepsResult } from "./reconcileStaleSteps.js";
import { getRevision, getString, isTerminalStatus, listTaskJsonPaths, loadTaskJson } from "./taskStore.js";
import { nowIsoJst } from "./time.js";
import type { OrchestratorSettings } from "./types.js";

function isoJstMinusMs(ms: number): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  return `${new Date(Date.now() - ms + offsetMs).toISOString().slice(0, 19)}+09:00`;
}

export type ReconcileResult = {
  resetProcessing: number;
  inserted: number;
  scanned: number;
  stale: ReconcileStaleStepsResult;
};

export async function reconcile(
  params: {
    settings?: OrchestratorSettings;
    processingTimeoutMs?: number;
    staleDryRun?: boolean;
    staleThresholdOverrides?: Record<string, number>;
  } = {},
): Promise<ReconcileResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const stale = await reconcileStaleSteps({
    settings,
    ...(params.staleDryRun === true ? { dryRun: true } : {}),
    ...(params.staleThresholdOverrides ? { thresholdOverrides: params.staleThresholdOverrides } : {}),
  });
  const repo = createOutboxRepo(settings);
  let inserted = 0;
  let scanned = 0;
  try {
    repo.init();
    const processingMs =
      params.processingTimeoutMs ??
      settings.publishConfig.orchestrator.reconcile.processing_timeout_ms;
    const resetProcessing = repo.resetStaleProcessing(isoJstMinusMs(processingMs));
    for (const tpath of listTaskJsonPaths(settings)) {
      const task = loadTaskJson(tpath);
      scanned += 1;
      const status = typeof task.status === "string" ? task.status : "";
      if (isTerminalStatus(status)) continue;
      const taskId = getString(task, "task_id");
      const runId = getString(task, "run_id");
      if (repo.hasOpenEventForTask(taskId, runId)) continue;
      repo.insertEvent({
        eventId: `evt_${randomUUID()}`,
        eventType: "TASK_RECONCILE",
        taskId,
        runId,
        revision: getRevision(task),
        payload: { reason: "startup_reconcile" },
        now: nowIsoJst(),
      });
      inserted += 1;
    }
    return { resetProcessing, inserted, scanned, stale };
  } finally {
    repo.close();
  }
}
