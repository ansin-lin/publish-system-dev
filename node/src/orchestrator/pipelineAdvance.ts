import { decideNextAction } from "./decideNextAction.js";
import { dispatchOnce } from "./dispatcher.js";
import { reconcile } from "./reconcile.js";
import { loadTaskJson, taskJsonPath } from "./taskStore.js";
import type { OrchestratorSettings } from "./types.js";

export type PipelineAdvanceResult = {
  rounds: number;
  finalStatus: string;
  lastDispatch: { claimed: number; done: number; failed: number };
};

/** After pick / reconcile: run dispatcher until decideNextAction is NOOP for this task. */
export async function advanceTaskPipelineUntilIdle(
  taskId: string,
  settings: OrchestratorSettings,
  maxRounds = 20,
): Promise<PipelineAdvanceResult> {
  let lastDispatch = { claimed: 0, done: 0, failed: 0 };
  for (let round = 0; round < maxRounds; round += 1) {
    const tpath = taskJsonPath(settings, taskId);
    const task = loadTaskJson(tpath);
    const action = decideNextAction(task);
    if (action.type === "NOOP") {
      return {
        rounds: round,
        finalStatus: typeof task.status === "string" ? task.status : "",
        lastDispatch,
      };
    }

    await reconcile({ settings });
    lastDispatch = await dispatchOnce({ limit: 10, settings });
    if (lastDispatch.failed > 0) {
      throw new Error(`pipeline dispatch failed for task ${taskId} (round ${round + 1})`);
    }
  }

  const task = loadTaskJson(taskJsonPath(settings, taskId));
  throw new Error(
    `pipeline did not reach idle after ${maxRounds} rounds (task ${taskId}, status=${task.status})`,
  );
}
