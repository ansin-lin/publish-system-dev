import type { JsonObject } from "../step2-collect/types.js";
import { executeStep2Collect } from "../step2-collect/executor.js";
import { executeTidyFromCollect } from "../step3-tidy/index.js";
import { executeStep4SlackNotify } from "../step4-approval/slackNotify.js";
import { generateTopicResearch } from "../step5-research/generateResearch.js";
import { generateCopy } from "../step6-generate/generateCopy.js";
import { generateImages } from "../step6-generate/generateImages.js";
import { executeStep7Publish } from "../step7-publish/executor.js";
import { loadOrchestratorSettings } from "./config.js";
import { decideNextAction } from "./decideNextAction.js";
import { createOutboxRepo } from "./outboxRepo.js";
import { loadTaskJson, taskJsonPath } from "./taskStore.js";
import { mergeStep } from "./taskMutations.js";
import { updateTask } from "./updateTask.js";
import type { OrchestratorSettings, OutboxEvent, TaskJson } from "./types.js";

function stepStatus(task: TaskJson, stepName: string): string {
  const steps = task.steps;
  if (!steps || typeof steps !== "object" || Array.isArray(steps)) return "";
  const step = (steps as JsonObject)[stepName];
  if (!step || typeof step !== "object" || Array.isArray(step)) return "";
  const status = (step as JsonObject).status;
  return typeof status === "string" ? status : "";
}

export type DispatchOnceResult = {
  claimed: number;
  done: number;
  failed: number;
};

async function handleEvent(event: OutboxEvent, _dispatcherId: string, settings: OrchestratorSettings): Promise<void> {
  const tpath = taskJsonPath(settings, event.task_id);
  const task = loadTaskJson(tpath);

  // Always decide from the latest task.json. Outbox revision only records which
  // update enqueued the event; benign follow-ups (e.g. step4_slack_poll_cursor)
  // must not prevent Step5+ from running for an older pick event.
  const action = decideNextAction(task);
  if (action.type === "EXECUTE_STEP2_COLLECT") {
    const execution = await executeStep2Collect(tpath);
    await updateTask(
      {
        taskJsonPath: tpath,
        reason: "collect_finished",
        changedFields: ["steps.collect", ...(execution.degraded ? ["degraded"] : [])],
        payload: { output_ref: execution.outputPath, ok: execution.ok },
        mutate: (draft) => {
          mergeStep(draft, "collect", execution.stepPatch);
          if (execution.degraded) draft.degraded = true;
        },
      },
      settings,
    );
    return;
  }

  if (action.type === "ADVANCE_TO_COLLECTED") {
    await updateTask(
      {
        taskJsonPath: tpath,
        reason: "collect_promoted",
        changedFields: ["status"],
        payload: { from: "collecting", to: "collected" },
        mutate: (draft) => {
          draft.status = "collected";
        },
      },
      settings,
    );
    return;
  }

  if (action.type === "ADVANCE_TO_COLLECTED_DEGRADED") {
    await updateTask(
      {
        taskJsonPath: tpath,
        reason: "collect_partial_degraded_continue",
        changedFields: ["status", "degraded"],
        payload: { from: "collecting", to: "collected" },
        mutate: (draft) => {
          draft.status = "collected";
          draft.degraded = true;
        },
      },
      settings,
    );
    return;
  }

  if (action.type === "EXECUTE_TIDY") {
    const isLegacyAnalyzing = task.status === "analyzing";
    if (stepStatus(task, "tidy") !== "running") {
      await updateTask(
        {
          taskJsonPath: tpath,
          reason: "tidy_started",
          changedFields: ["steps.tidy"],
          payload: { from: task.status },
          mutate: (draft, context) => {
            mergeStep(draft, "tidy", { status: "running", started_at: context.now });
          },
        },
        settings,
      );
    }

    const execution = await executeTidyFromCollect({ taskJsonPath: tpath });
    await updateTask(
      {
        taskJsonPath: tpath,
        reason: execution.ok ? "tidy_finished" : "tidy_failed",
        changedFields: ["steps.tidy", ...(execution.ok && isLegacyAnalyzing ? ["status"] : [])],
        payload: { output_ref: execution.ok ? execution.outputPath : undefined, ok: execution.ok },
        mutate: (draft) => {
          mergeStep(draft, "tidy", execution.stepPatch);
          if (execution.ok && isLegacyAnalyzing) draft.status = "collected";
        },
      },
      settings,
    );
    return;
  }

  if (action.type === "ADVANCE_TO_ANALYZED") {
    await updateTask(
      {
        taskJsonPath: tpath,
        reason: "analyze_promoted",
        changedFields: ["status"],
        payload: { from: "analyzing", to: "analyzed" },
        mutate: (draft) => {
          draft.status = "analyzed";
        },
      },
      settings,
    );
    return;
  }

  if (action.type === "EXECUTE_STEP4_SLACK_NOTIFY") {
    const execution = await executeStep4SlackNotify(tpath, settings);
    if (execution.ok) {
      await updateTask(
        {
          taskJsonPath: tpath,
          reason: "step4_slack_candidates_sent",
          changedFields: ["status", "steps.approval"],
          payload: {
            message_ts: execution.message_ts,
            slack_channel: execution.slack_channel,
            candidate_count: execution.candidate_count,
          },
          mutate: (draft, context) => {
            draft.status = "awaiting_manager_selection";
            mergeStep(draft, "approval", {
              status: "running",
              started_at: context.now,
              message_ts: execution.message_ts,
              slack_channel: execution.slack_channel,
              candidate_count: execution.candidate_count,
              slack_text_preview: execution.slack_text_preview,
            });
          },
        },
        settings,
      );
    } else {
      await updateTask(
        {
          taskJsonPath: tpath,
          reason: "step4_slack_notify_failed",
          changedFields: ["steps.approval"],
          payload: {},
          mutate: (draft) => {
            mergeStep(draft, "approval", execution.stepPatch);
          },
        },
        settings,
      );
    }
    return;
  }

  if (action.type === "EXECUTE_STEP4_GENERATE_RESEARCH") {
    await generateTopicResearch({ taskJsonPath: tpath });
    return;
  }

  if (action.type === "EXECUTE_STEP6_GENERATE_COPY") {
    await generateCopy({ taskJsonPath: tpath });
    await generateImages({ taskJsonPath: tpath });
    return;
  }

  if (action.type === "EXECUTE_STEP6_GENERATE_IMAGES") {
    await generateImages({ taskJsonPath: tpath });
    return;
  }

  if (action.type === "EXECUTE_STEP7_PUBLISH") {
    await executeStep7Publish({ taskJsonPath: tpath, operator: "orchestrator", settings });
    return;
  }
}

export async function dispatchOnce(params: {
  limit?: number;
  dispatcherId?: string;
  settings?: OrchestratorSettings;
} = {}): Promise<DispatchOnceResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const repo = createOutboxRepo(settings);
  const dispatcherId = params.dispatcherId ?? `dispatcher-${process.pid}`;
  let claimed = 0;
  let done = 0;
  let failed = 0;
  try {
    repo.init();
    const events = repo.listReady(params.limit ?? 10);
    for (const event of events) {
      if (!repo.claim(event.event_id, dispatcherId)) continue;
      claimed += 1;
      try {
        await handleEvent(event, dispatcherId, settings);
        repo.markDone(event.event_id);
        done += 1;
      } catch {
        repo.retryOrFail(event, 3, [1000, 3000, 10_000]);
        failed += 1;
      }
    }
    return { claimed, done, failed };
  } finally {
    repo.close();
  }
}
