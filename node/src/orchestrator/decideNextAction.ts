import type { NextAction, TaskJson } from "./types.js";
import { loadPublishOrchestratorConfig } from "./publishOrchestratorConfig.js";
import { hasTopicResearchReady, stepStatus } from "./taskStepChecks.js";
import { platformsNeedingRetry } from "../step7-publish/publishPartialRetry.js";
import {
  copyReviewBlocksPublish,
} from "../step6-review/copyReviewGuards.js";

function copyStepNeedsRun(task: TaskJson): boolean {
  const copyStatus = stepStatus(task, "copy");
  return !copyStatus || copyStatus === "pending" || copyStatus === "failed";
}

function step6CopyAction(reason: string): NextAction {
  return {
    type: "EXECUTE_STEP6_GENERATE_COPY",
    reason,
  };
}

export function decideNextAction(task: TaskJson): NextAction {
  const status = typeof task.status === "string" ? task.status : "";

  if (status === "collecting") {
    const collectStatus = stepStatus(task, "collect");
    if (collectStatus === "running") {
      return { type: "EXECUTE_STEP2_COLLECT", reason: "collect step is running" };
    }
    if (collectStatus === "success") {
      return { type: "ADVANCE_TO_COLLECTED", reason: "collect succeeded" };
    }
    if (collectStatus === "partial_failed") {
      return { type: "ADVANCE_TO_COLLECTED_DEGRADED", reason: "collect partially failed; degrade and continue with tidy" };
    }
    if (collectStatus === "failed" || collectStatus === "init_failed") {
      return { type: "NOOP", reason: `collect ${collectStatus}; tidy is blocked` };
    }
  }

  if (status === "collected") {
    const tidyStatus = stepStatus(task, "tidy");
    if (!tidyStatus || tidyStatus === "pending" || tidyStatus === "failed") {
      return { type: "EXECUTE_TIDY", reason: "task is collected; build topic_candidates from collect_result" };
    }
    if (tidyStatus === "running") {
      return { type: "NOOP", reason: "tidy step is running" };
    }
    if (tidyStatus === "success") {
      const approvalStatus = stepStatus(task, "approval");
      if (!approvalStatus || approvalStatus === "pending" || approvalStatus === "failed") {
        return {
          type: "EXECUTE_STEP4_SLACK_NOTIFY",
          reason: "tidy succeeded; post Step4 candidate list to Slack for manager pick",
        };
      }
      return { type: "NOOP", reason: `approval step is ${approvalStatus}` };
    }
    return { type: "NOOP", reason: `tidy step is ${tidyStatus}` };
  }

  if (status === "analyzing") {
    const analyzeStatus = stepStatus(task, "analyze");
    if (analyzeStatus === "success") {
      return { type: "ADVANCE_TO_ANALYZED", reason: "legacy analyze succeeded" };
    }
    if (analyzeStatus === "failed") {
      return { type: "NOOP", reason: "legacy analyze failed" };
    }
    const tidyStatus = stepStatus(task, "tidy");
    if (!tidyStatus || tidyStatus === "pending" || tidyStatus === "failed" || tidyStatus === "running") {
      return {
        type: "EXECUTE_TIDY",
        reason: "legacy task.status=analyzing; run tidy from collect and move to collected",
      };
    }
    return { type: "NOOP", reason: `legacy analyzing; analyze=${analyzeStatus} tidy=${tidyStatus}` };
  }

  if (status === "generating_copy") {
    const copyStatus = stepStatus(task, "copy");
    const copyStep = task.steps;
    const copyRecord =
      copyStep && typeof copyStep === "object" && !Array.isArray(copyStep) ?
        (copyStep as Record<string, unknown>).copy
      : null;
    const copyHasError =
      copyRecord && typeof copyRecord === "object" && !Array.isArray(copyRecord) &&
      typeof (copyRecord as Record<string, unknown>).error === "string" &&
      String((copyRecord as Record<string, unknown>).error).trim().length > 0;
    if (copyStatus === "running" && copyHasError) {
      return step6CopyAction("generating_copy; copy step has error while running — retry");
    }
    if (copyStatus === "running") {
      return { type: "NOOP", reason: "Step6 copy is running; wait for completion or stale rollback" };
    }
    if (!copyStatus || copyStatus === "pending" || copyStatus === "failed") {
      return step6CopyAction("generating_copy; resume or retry copy generation");
    }
    if (copyStatus === "success") {
      return {
        type: "EXECUTE_STEP6_GENERATE_IMAGES",
        reason: "copy step succeeded; continue to image generation",
      };
    }
    return { type: "NOOP", reason: `generating_copy; copy=${copyStatus}` };
  }

  if (status === "research_done") {
    if (!hasTopicResearchReady(task)) {
      return { type: "NOOP", reason: "research_done but topic_research artifact missing or research step not success" };
    }
    if (copyStepNeedsRun(task)) {
      return step6CopyAction("research_done; generate copy and image prompts via content-copy");
    }
    return { type: "NOOP", reason: `research_done; copy step is ${stepStatus(task, "copy")}` };
  }

  if (status === "manager_selected") {
    if (!hasTopicResearchReady(task)) {
      return {
        type: "NOOP",
        reason: "legacy manager_selected without topic_research; run Step5 or fix task",
      };
    }
    if (copyStepNeedsRun(task)) {
      return step6CopyAction("topic_research ready; generate copy and image prompts via content-copy");
    }
    return { type: "NOOP", reason: `manager_selected; copy step is ${stepStatus(task, "copy")}` };
  }

  if (status === "copy_generated" || status === "generating_image") {
    const imageStatus = stepStatus(task, "image");
    if (
      !imageStatus ||
      imageStatus === "pending" ||
      imageStatus === "failed" ||
      imageStatus === "running"
    ) {
      return {
        type: "EXECUTE_STEP6_GENERATE_IMAGES",
        reason: "copy_result ready; generate images via content-image with merged prompts",
      };
    }
    return { type: "NOOP", reason: `${status}; image step is ${imageStatus}` };
  }

  if (status === "image_generated" || status === "publishing") {
    const imageStatus = stepStatus(task, "image");
    const publishStatus = stepStatus(task, "publish");
    if (imageStatus === "success" && (!publishStatus || publishStatus === "pending" || publishStatus === "failed")) {
      const orch = loadPublishOrchestratorConfig();
      if (copyReviewBlocksPublish(task, orch, status)) {
        return {
          type: "NOOP",
          reason: "image_generated but publish_review not approved; awaiting dashboard approve",
        };
      }
      return {
        type: "EXECUTE_STEP7_PUBLISH",
        reason: "image_result ready; run Playwright publish for enabled platforms",
      };
    }
    if (publishStatus === "running") {
      return { type: "NOOP", reason: "Step7 publish is running" };
    }
    return { type: "NOOP", reason: `image_generated; image=${imageStatus} publish=${publishStatus}` };
  }

  if (status === "awaiting_publish_review" || status === "revising_copy") {
    return {
      type: "NOOP",
      reason: `${status}; waiting for publish review or copy regeneration`,
    };
  }

  if (status === "publish_partial_failed") {
    const orch = loadPublishOrchestratorConfig();
    if (orch.step7.partial_retry.enabled && orch.step7.retry_step7_enabled) {
      const needs = platformsNeedingRetry(task, orch);
      if (needs.length > 0 && orch.step7.partial_retry.auto_on_run_once) {
        return {
          type: "EXECUTE_STEP7_PUBLISH",
          reason: `Step7 partial auto-retry: ${needs.join(",")}`,
        };
      }
    }
    return { type: "NOOP", reason: "publish_partial_failed; awaiting Slack retry or manual publish-task" };
  }

  if (status === "topics_selected" || status === "generating_research") {
    const approveStatus = stepStatus(task, "approve");
    const researchStatus = stepStatus(task, "research");
    if (researchStatus === "running") {
      return {
        type: "NOOP",
        reason: "Step5 research is running; wait for completion or stale rollback",
      };
    }
    if (
      approveStatus === "success" &&
      (!researchStatus || researchStatus === "pending" || researchStatus === "failed")
    ) {
      return {
        type: "EXECUTE_STEP4_GENERATE_RESEARCH",
        reason: "Step5: content-research → topic_research.v1",
      };
    }
    return {
      type: "NOOP",
      reason: `${status}; approve=${approveStatus} research=${researchStatus}`,
    };
  }

  if (status === "analyzed") {
    const analyzeStatus = stepStatus(task, "analyze");
    const tidyStatus = stepStatus(task, "tidy");
    if (analyzeStatus === "running" || analyzeStatus === "pending" || analyzeStatus === "failed") {
      return {
        type: "EXECUTE_TIDY",
        reason: "legacy analyzed task with analyze rerun; prefer tidy from collect",
      };
    }
    if (tidyStatus === "running" || tidyStatus === "pending" || tidyStatus === "failed") {
      return { type: "EXECUTE_TIDY", reason: "legacy analyzed task; run tidy before Step4" };
    }
    if (analyzeStatus === "success" || tidyStatus === "success") {
      const approvalStatus = stepStatus(task, "approval");
      if (!approvalStatus || approvalStatus === "pending" || approvalStatus === "failed") {
        return {
          type: "EXECUTE_STEP4_SLACK_NOTIFY",
          reason: "candidates ready; post Step4 list to Slack for manager pick",
        };
      }
      return { type: "NOOP", reason: `approval step is ${approvalStatus}` };
    }
    return { type: "NOOP", reason: "legacy analyzed task; no analyze or tidy success" };
  }

  return { type: "NOOP", reason: `no action for task.status=${status}` };
}
