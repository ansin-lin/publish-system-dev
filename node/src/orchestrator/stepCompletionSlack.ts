import { loadOrchestratorSlackStep4Config } from "./orchestratorSlackConfig.js";
import { loadOrchestratorSettings } from "./config.js";
import { loadPublishOrchestratorConfig } from "./publishOrchestratorConfig.js";
import { loadTaskJson } from "./taskStore.js";
import { formatDisplayJst, nowDisplayJst } from "./time.js";
import type { OrchestratorSettings } from "./types.js";
import { slackChatPostMessage } from "../step4-approval/slackClient.js";

export type PipelineStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type StepNotifyPostResult =
  | { ok: true; message_ts: string; channel: string }
  | { ok: false; reason: string };

const STEP_LABELS: Record<PipelineStepNumber, string> = {
  1: "任务创建",
  2: "话题采集",
  3: "话题整理",
  4: "管理者选题",
  5: "内容素材调研",
  6: "文案和图片生成",
  7: "发布",
};

/** Config `slack.step_completion.enabled`; env `PUBLISH_ORCH_STEP_NOTIFY=0` overrides off. */
export function isStepCompletionNotifyEnabled(): boolean {
  const raw = process.env.PUBLISH_ORCH_STEP_NOTIFY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return loadPublishOrchestratorConfig().slack.step_completion.enabled;
}

function isStepNotifyDryRun(): boolean {
  const raw = process.env.PUBLISH_ORCH_STEP_NOTIFY_DRY_RUN?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  const cfg = loadPublishOrchestratorConfig();
  if (cfg.slack.step_completion.dry_run) return true;
  return (
    process.env.PUBLISH_ORCH_STEP4_DRY_RUN === "1" ||
    String(process.env.PUBLISH_ORCH_STEP4_DRY_RUN ?? "").toLowerCase() === "true" ||
    cfg.slack.step4.dry_run
  );
}

function buildMessage(params: {
  step: PipelineStepNumber;
  taskId: string;
  runId: string;
  at: string;
  detail?: string;
}): string {
  const label = STEP_LABELS[params.step];
  const lines = [
    `✅ Step${params.step} ${label}完成 — ${params.at}`,
    `task_id: \`${params.taskId}\` | run_id: \`${params.runId}\``,
  ];
  if (params.detail?.trim()) lines.push(params.detail.trim());
  return lines.join("\n");
}

/**
 * Posts a short status line to Slack (direct API only, no agent reply).
 * Missing token/channel or API errors are logged and do not throw.
 */
export async function notifyStepCompleted(params: {
  step: PipelineStepNumber;
  taskId: string;
  runId: string;
  at?: string;
  detail?: string;
  settings?: OrchestratorSettings;
}): Promise<StepNotifyPostResult> {
  if (!isStepCompletionNotifyEnabled()) {
    return { ok: false, reason: "notify_disabled" };
  }

  const taskId = params.taskId.trim();
  const runId = params.runId.trim();
  if (!taskId) return { ok: false, reason: "missing_task_id" };

  const at = params.at?.trim() ? formatDisplayJst(params.at) : nowDisplayJst();
  const text = buildMessage({
    step: params.step,
    taskId,
    runId,
    at,
    ...(params.detail !== undefined ? { detail: params.detail } : {}),
  });

  if (isStepNotifyDryRun()) {
    // eslint-disable-next-line no-console
    console.log("[StepNotify DRY_RUN]\n", text);
    return { ok: false, reason: "dry_run" };
  }

  try {
    const settings = params.settings ?? loadOrchestratorSettings();
    const cfg = loadOrchestratorSlackStep4Config(settings, {
      requireSlackBotToken: true,
      requireSlackChannel: true,
    });
    const post = await slackChatPostMessage({
      token: cfg.botToken,
      channel: cfg.slack.channelId,
      text,
    });
    if (!post.ok || !post.ts) {
      const err = post.error ?? "unknown";
      // eslint-disable-next-line no-console
      console.warn(
        `[StepNotify] Step${params.step} chat.postMessage failed for ${taskId}: ${err}`,
      );
      return { ok: false, reason: err };
    }
    return { ok: true, message_ts: post.ts, channel: cfg.slack.channelId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.warn(`[StepNotify] Step${params.step} skipped for ${taskId}: ${message}`);
    return { ok: false, reason: message };
  }
}

export async function notifyStepCompletedForTask(params: {
  step: PipelineStepNumber;
  taskJsonPath: string;
  at?: string;
  detail?: string;
  settings?: OrchestratorSettings;
}): Promise<StepNotifyPostResult> {
  const task = loadTaskJson(params.taskJsonPath);
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "";
  return notifyStepCompleted({
    step: params.step,
    taskId,
    runId,
    ...(params.at !== undefined ? { at: params.at } : {}),
    ...(params.detail !== undefined ? { detail: params.detail } : {}),
    ...(params.settings !== undefined ? { settings: params.settings } : {}),
  });
}
