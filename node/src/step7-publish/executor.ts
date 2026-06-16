import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { isPlatformId, type PlatformId, type PublishResult } from "../shared/types.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { ensureTaskDirectories, loadTaskJson } from "../orchestrator/taskStore.js";
import { notifyStepCompletedForTask, type StepNotifyPostResult } from "../orchestrator/stepCompletionSlack.js";
import {
  formatStep7LaunchFailure,
  formatStep7PublishNotifyDetail,
} from "../orchestrator/stepNotifyDetail.js";
import { updateTask } from "../orchestrator/updateTask.js";
import { nowIsoJst, yyyymmddJst } from "../orchestrator/time.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { parsePlatformFilter, publishJob } from "../step7-publish/publish/index.js";
import { buildPublishJobFromStep6 } from "../step6-generate/buildPublishJob.js";
import { copyReviewBlocksPublish } from "../step6-review/copyReviewGuards.js";
import {
  bumpPartialRetryCounts,
  loadPlatformRowsForTask,
  mergePlatformResultRows,
  resolveStep7PlatformFilter,
} from "./publishPartialRetry.js";
import {
  applyVerificationToResults,
  buildPublishSummary,
  summarizeTerminalFromRows,
  type PlatformResultRow,
} from "./publishVerification.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepField(task: JsonObject, stepName: string, field: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const v = step[field];
  return typeof v === "string" ? v : "";
}

function stepStatus(task: JsonObject, stepName: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  return typeof step.status === "string" ? step.status : "";
}

function captureFailureScreenshots(results: PublishResult[]): void {
  for (const r of results) {
    if (r.status !== "failed" && r.status !== "manual_required") continue;
    const shot = r.artifacts.screenshotPath;
    if (!shot || fs.existsSync(shot)) continue;
    // runner usually writes screenshot; nothing to do here
  }
}

async function persistStep7SlackNotifyThread(
  taskJsonPath: string,
  settings: OrchestratorSettings,
  notify: StepNotifyPostResult,
): Promise<void> {
  if (!notify.ok) return;
  await updateTask(
    {
      taskJsonPath,
      reason: "step7_slack_notify_thread",
      changedFields: ["steps.publish"],
      payload: { message_ts: notify.message_ts, channel: notify.channel },
      mutate: (draft) => {
        mergeStep(draft, "publish", {
          message_ts: notify.message_ts,
          slack_thread_ts: notify.message_ts,
          slack_channel: notify.channel,
        });
      },
    },
    settings,
  );
}

async function persistPublishOutcome(params: {
  taskJsonPath: string;
  operator: string;
  settings: OrchestratorSettings;
  taskId: string;
  runId: string;
  copyPath: string;
  imagePath: string;
  built: Awaited<ReturnType<typeof buildPublishJobFromStep6>>;
  platformRows: PlatformResultRow[];
  ranPlatforms: PlatformId[];
  results: PublishResult[];
  publishDir: string;
  partialRetry: boolean;
}): Promise<{ publishResultPath: string; terminal: string; taskStatus: string }> {
  const terminal = summarizeTerminalFromRows(params.platformRows);
  const publishResultPath = path.resolve(params.publishDir, `publish_result_${yyyymmddJst()}_${params.runId}.json`);
  const summary = buildPublishSummary(params.platformRows);
  summary.status = terminal;
  if (params.built.videoSkippedPlatforms.length > 0) {
    summary.video_skipped_count = params.built.videoSkippedPlatforms.length;
  }

  const artifact: JsonObject = {
    schema_version: "publish_result.v1",
    generated_at: nowIsoJst(),
    task_id: params.taskId,
    run_id: params.runId,
    publish_id: params.built.publishId,
    topic_id: params.built.topicId,
    job_ref: params.built.jobPath,
    source_copy_ref: params.copyPath,
    source_image_ref: params.imagePath,
    platform_results: params.platformRows,
    video_skipped_platforms: params.built.videoSkippedPlatforms,
    summary,
    ...(params.partialRetry ? { partial_retry: true, retried_platforms: params.ranPlatforms } : {}),
  };
  fs.writeFileSync(publishResultPath, JSON.stringify(artifact, null, 2), "utf-8");

  const retryCounts = bumpPartialRetryCounts(loadTaskJson(params.taskJsonPath), params.ranPlatforms);

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: terminal === "published" ? "step7_publish_finished" : "step7_publish_partial_or_failed",
      operator: params.operator,
      changedFields: ["status", "steps.publish"],
      payload: {
        publish_result_ref: publishResultPath,
        terminal,
        published_count: summary.published_count,
        verified_published_count: summary.verified_published_count,
        false_success_count: summary.false_success_count,
      },
      mutate: (draft, context) => {
        draft.status = terminal;
        mergeStep(draft, "publish", {
          status: terminal === "published" ? "success" : "partial_failed",
          finished_at: context.now,
          output_ref: publishResultPath,
          job_ref: params.built.jobPath,
          platform_results: params.platformRows,
          summary,
          video_skipped_platforms: params.built.videoSkippedPlatforms,
          partial_retry_counts: retryCounts,
        });
      },
    },
    params.settings,
  );

  return { publishResultPath, terminal, taskStatus: terminal };
}

export type ExecuteStep7PublishParams = {
  taskJsonPath: string;
  operator?: string;
  settings?: OrchestratorSettings;
  platformFilter?: PlatformId[];
  dryRun?: boolean;
  headless?: boolean;
};

export type ExecuteStep7PublishResult = {
  jobPath: string;
  publishResultPath: string;
  publishId: string;
  platforms: PlatformId[];
  taskStatus: string;
  platformResults: JsonObject[];
  dryRun: boolean;
  partialRetry?: boolean;
};

export async function executeStep7Publish(params: ExecuteStep7PublishParams): Promise<ExecuteStep7PublishResult> {
  const settings = params.settings ?? loadOrchestratorSettings();
  const orchConfig = settings.publishConfig;
  const operator = params.operator ?? "orchestrator";
  const task = loadTaskJson(params.taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "r01";

  if (!taskId) throw new Error("executeStep7Publish: task_id missing");

  const allowedStatuses = new Set(["image_generated", "publishing", "publish_partial_failed", "failed", "published"]);
  if (!allowedStatuses.has(status)) {
    throw new Error(
      `executeStep7Publish: task.status must be image_generated|publishing|publish_partial_failed|failed|published (got ${status})`,
    );
  }

  const copyPath = stepField(task, "copy", "output_ref");
  const imagePath = stepField(task, "image", "output_ref");
  if (!copyPath || !fs.existsSync(copyPath)) {
    throw new Error(`executeStep7Publish: missing steps.copy.output_ref (${copyPath})`);
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`executeStep7Publish: missing steps.image.output_ref (${imagePath})`);
  }
  if (stepStatus(task, "image") !== "success") {
    throw new Error("executeStep7Publish: steps.image must be success");
  }

  if (copyReviewBlocksPublish(task, orchConfig, status)) {
    throw new Error(
      "executeStep7Publish: publish_review enabled — approve copy on dashboard or CLI approve-publish first",
    );
  }

  const envPlatformFilter = parsePlatformFilter(process.env.PUBLISH_ORCH_STEP7_PLATFORMS);
  const cliFilter = params.platformFilter ?? envPlatformFilter;
  const resolvedFilter = resolveStep7PlatformFilter({
    task,
    config: orchConfig,
    ...(cliFilter ? { cliFilter } : {}),
    taskStatus: status,
  });
  const configPlatforms = orchConfig.platforms.publish_enabled.filter((p): p is PlatformId => isPlatformId(p));
  const platformFilter = resolvedFilter ?? configPlatforms;
  const partialRetry = status === "publish_partial_failed" || status === "failed" || status === "published";
  const previousRows = partialRetry ? loadPlatformRowsForTask(task) : [];

  ensureTaskDirectories(settings, taskId);
  const publishDir = path.resolve(path.dirname(params.taskJsonPath), "publish");

  const built = buildPublishJobFromStep6({
    taskId,
    runId,
    copyPath,
    imagePath,
    publishDir,
    ...(platformFilter.length > 0 ? { platformFilter } : {}),
    ...(params.headless !== undefined ? { headless: params.headless } : {}),
  });

  const dryRun =
    params.dryRun === true ||
    orchConfig.step7.dry_run ||
    process.env.PUBLISH_ORCH_STEP7_DRY_RUN === "1";

  if (dryRun) {
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "step7_publish_dry_run",
        operator,
        changedFields: ["steps.publish"],
        payload: { job_ref: built.jobPath, dry_run: true },
        mutate: (draft) => {
          mergeStep(draft, "publish", {
            status: "pending",
            job_ref: built.jobPath,
            dry_run_preview: true,
            platforms: built.platforms,
          });
        },
      },
      settings,
    );

    return {
      jobPath: built.jobPath,
      publishResultPath: "",
      publishId: built.publishId,
      platforms: built.platforms,
      taskStatus: status === "publish_partial_failed" ? status : "image_generated",
      platformResults: [],
      dryRun: true,
    };
  }

  await updateTask(
    {
      taskJsonPath: params.taskJsonPath,
      reason: partialRetry ? "step7_publish_partial_retry_started" : "step7_publish_started",
      operator,
      changedFields: ["status", "steps.publish"],
      payload: {
        job_ref: built.jobPath,
        platforms: built.platforms,
        video_skipped_platforms: built.videoSkippedPlatforms,
        partial_retry: partialRetry,
      },
      mutate: (draft, context) => {
        draft.status = "publishing";
        mergeStep(draft, "publish", {
          status: "running",
          started_at: context.now,
          input_ref: built.jobPath,
          job_ref: built.jobPath,
          copy_ref: copyPath,
          image_ref: imagePath,
          platforms: built.platforms,
          video_skipped_platforms: built.videoSkippedPlatforms,
        });
      },
    },
    settings,
  );

  const validationConfig = {
    strict: orchConfig.step7.validation.strict,
    mode: orchConfig.step7.validation.mode,
    require_post_url: orchConfig.step7.validation.require_post_url,
  };
  let results: PublishResult[] = [];

  try {
    const run = await publishJob({
      jobPath: built.jobPath,
      platformFilter: built.platforms,
    });
    const verified = applyVerificationToResults(run.results, validationConfig);
    results = verified.results;
    captureFailureScreenshots(results);

    const freshRows = verified.rows;
    const platformRows =
      partialRetry && previousRows.length > 0
        ? mergePlatformResultRows(previousRows, freshRows, built.platforms)
        : freshRows;

    const outcome = await persistPublishOutcome({
      taskJsonPath: params.taskJsonPath,
      operator,
      settings,
      taskId,
      runId,
      copyPath,
      imagePath,
      built,
      platformRows,
      ranPlatforms: built.platforms,
      results,
      publishDir,
      partialRetry,
    });

    const notify = await notifyStepCompletedForTask({
      step: 7,
      taskJsonPath: params.taskJsonPath,
      settings,
      detail: formatStep7PublishNotifyDetail(results, {
        videoSkippedPlatforms: built.videoSkippedPlatforms,
        platformRows,
      }),
    });
    await persistStep7SlackNotifyThread(params.taskJsonPath, settings, notify);

    return {
      jobPath: built.jobPath,
      publishResultPath: outcome.publishResultPath,
      publishId: built.publishId,
      platforms: built.platforms,
      taskStatus: outcome.taskStatus,
      platformResults: platformRows,
      dryRun: false,
      partialRetry,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTask(
      {
        taskJsonPath: params.taskJsonPath,
        reason: "step7_publish_failed",
        operator,
        changedFields: ["status", "steps.publish"],
        payload: { error: message, job_ref: built.jobPath },
        mutate: (draft, context) => {
          draft.status = "failed";
          mergeStep(draft, "publish", {
            status: "failed",
            finished_at: context.now,
            job_ref: built.jobPath,
            error: message,
          });
        },
      },
      settings,
    );
    const notify = await notifyStepCompletedForTask({
      step: 7,
      taskJsonPath: params.taskJsonPath,
      settings,
      detail: formatStep7LaunchFailure(message, built.platforms),
    });
    await persistStep7SlackNotifyThread(params.taskJsonPath, settings, notify);
    throw error;
  }
}
