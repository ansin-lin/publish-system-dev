import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSlackStep4Config } from "../orchestrator/orchestratorSlackConfig.js";
import { loadOrchestratorSettings } from "../orchestrator/config.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { listTaskJsonPaths, loadTaskJson } from "../orchestrator/taskStore.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { updateTask } from "../orchestrator/updateTask.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { isPlatformId, PLATFORM_IDS, type PlatformId } from "../shared/types.js";
import { slackChatPostMessage } from "../step4-approval/slackClient.js";
import { appendStep4SlackLog } from "../step4-approval/step4SlackLog.js";
import {
  fetchThreadReplies,
  maxSlackTs,
  selectNewHumanPickCandidates,
  type SlackReplyRow,
} from "../step4-approval/slackPickPoll.js";
import { executeStep7Publish } from "./executor.js";
import { bumpPartialRetryCounts, platformsNeedingRetry } from "./publishPartialRetry.js";

const RETRY_LINE_RE = /^retry\s+(.+)$/i;

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

export function isRetryCommandText(text: string): boolean {
  return RETRY_LINE_RE.test(text.trim());
}

export function parseRetryPlatforms(text: string, config = loadPublishOrchestratorConfig()): PlatformId[] | null {
  const m = text.trim().match(RETRY_LINE_RE);
  if (!m?.[1]) return null;
  const parts = m[1]
    .split(/[,，\s、]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const out: PlatformId[] = [];
  const bad: string[] = [];
  for (const part of parts) {
    if (isPlatformId(part)) {
      out.push(part);
      continue;
    }
    let found: PlatformId | null = null;
    for (const id of PLATFORM_IDS) {
      const def = config.platforms.definitions[id];
      const aliases = def?.aliases ?? [];
      if (id === part || aliases.some((a) => a.toLowerCase() === part)) {
        found = id;
        break;
      }
      if (def?.label && def.label.toLowerCase() === part) {
        found = id;
        break;
      }
    }
    if (found) out.push(found);
    else bad.push(part);
  }
  if (bad.length > 0) return null;
  return [...new Set(out)];
}

export type Step7PollSlackRetryResult = {
  scanned: number;
  eligible: number;
  polled: number;
  retries_triggered: number;
  retry_errors: number;
  skipped: number;
  results: Array<{ task_id: string; outcome: string; detail?: string }>;
};

async function replyInThread(params: {
  token: string;
  channel: string;
  threadTs: string;
  text: string;
}): Promise<void> {
  const post = await slackChatPostMessage({
    token: params.token,
    channel: params.channel,
    text: params.text,
    thread_ts: params.threadTs,
  });
  if (!post.ok) {
    appendStep4SlackLog("step7_retry_reply_failed", {
      channel: params.channel,
      thread_ts: params.threadTs,
      error: post.error,
    });
  }
}

function taskEligibleForRetryPoll(status: string): boolean {
  return status === "publish_partial_failed" || status === "failed" || status === "published";
}

/** Step7 完成通知线程优先；无记录时回退 Step4 选题帖（旧任务）。 */
export function resolveStep7RetrySlackThread(
  task: JsonObject,
  channelDefault: string,
  threadSource: "step7" | "step4" = "step7",
): { channel: string; threadTs: string; rootTs: string } | null {
  const publishTs =
    stepField(task, "publish", "slack_thread_ts") || stepField(task, "publish", "message_ts");
  const publishChannel = stepField(task, "publish", "slack_channel");
  const approvalTs =
    stepField(task, "approval", "slack_thread_ts") || stepField(task, "approval", "message_ts");
  const approvalChannel = stepField(task, "approval", "slack_channel");

  if (threadSource === "step4") {
    if (!approvalTs) return null;
    return {
      channel: approvalChannel || channelDefault,
      threadTs: approvalTs,
      rootTs: stepField(task, "approval", "message_ts") || approvalTs,
    };
  }

  if (publishTs) {
    return {
      channel: publishChannel || channelDefault,
      threadTs: publishTs,
      rootTs: publishTs,
    };
  }
  if (approvalTs) {
    return {
      channel: approvalChannel || channelDefault,
      threadTs: approvalTs,
      rootTs: stepField(task, "approval", "message_ts") || approvalTs,
    };
  }
  return null;
}

export async function step7PollSlackRetry(
  settings: OrchestratorSettings,
): Promise<Step7PollSlackRetryResult> {
  const cfg = loadPublishOrchestratorConfig();
  const out: Step7PollSlackRetryResult = {
    scanned: 0,
    eligible: 0,
    polled: 0,
    retries_triggered: 0,
    retry_errors: 0,
    skipped: 0,
    results: [],
  };

  const recv = cfg.slack.step7?.retry_receive;
  if (!recv || recv.mode !== "poll" || recv.poll_on !== "run-once") return out;
  if (!cfg.step7.partial_retry.enabled) return out;

  let slackCfg: ReturnType<typeof loadOrchestratorSlackStep4Config>;
  try {
    slackCfg = loadOrchestratorSlackStep4Config(settings, {
      requireSlackBotToken: true,
      requireSlackChannel: true,
    });
  } catch {
    return out;
  }
  const token = slackCfg.botToken.trim();
  if (!token || slackCfg.dryRun) return out;

  const replies = recv.replies;
  const channelDefault = slackCfg.slack.channelId;
  const allowedUsers = slackCfg.slack.allowedSlackUserIds;

  for (const tpath of listTaskJsonPaths(settings)) {
    out.scanned += 1;
    const task = loadTaskJson(tpath);
    const status = typeof task.status === "string" ? task.status : "";
    if (!taskEligibleForRetryPoll(status)) continue;
    out.eligible += 1;

    const taskId = typeof task.task_id === "string" ? task.task_id : "unknown";
    const threadSource = recv.thread_source ?? "step7";
    const slackThread = resolveStep7RetrySlackThread(task, channelDefault, threadSource);
    if (!slackThread) {
      out.skipped += 1;
      out.results.push({ task_id: taskId, outcome: "skipped", detail: "no_step7_slack_thread" });
      continue;
    }
    const { channel, threadTs, rootTs } = slackThread;

    const lastPolled = stepField(task, "publish", "retry_last_polled_ts");

    const fetched = await fetchThreadReplies({ token, channel, threadTs });
    if (!fetched.ok) {
      out.retry_errors += 1;
      out.results.push({ task_id: taskId, outcome: "poll_error", detail: fetched.error });
      continue;
    }

    const candidates = selectNewHumanPickCandidates({
      messages: fetched.messages,
      threadTs,
      lastPolledTs: lastPolled || undefined,
      rootMessageTs: rootTs,
    }).filter((m) => isRetryCommandText(m.text));

    if (candidates.length === 0) continue;

    out.polled += 1;
    let maxTs = lastPolled || rootTs;

    for (const msg of candidates) {
      maxTs = maxSlackTs(maxTs, msg.ts);
      if (!msg.user || !allowedUsers.includes(msg.user)) {
        await replyInThread({
          token,
          channel,
          threadTs,
          text: replies.unauthorized,
        });
        continue;
      }

      const platforms = parseRetryPlatforms(msg.text);
      if (!platforms || platforms.length === 0) {
        await replyInThread({ token, channel, threadTs, text: replies.invalid });
        continue;
      }

      const allowed = platformsNeedingRetry(task, cfg);
      const toRun = platforms.filter((p) => allowed.includes(p));
      if (toRun.length === 0) {
        await replyInThread({
          token,
          channel,
          threadTs,
          text: replies.max_attempts,
        });
        continue;
      }

      try {
        await executeStep7Publish({
          taskJsonPath: tpath,
          operator: msg.user,
          settings,
          platformFilter: toRun,
        });
        out.retries_triggered += 1;
        await replyInThread({
          token,
          channel,
          threadTs,
          text: replies.success.replace("{platforms}", toRun.join(", ")),
        });
        out.results.push({
          task_id: taskId,
          outcome: "retry_triggered",
          detail: toRun.join(","),
        });
      } catch (e) {
        out.retry_errors += 1;
        const err = e instanceof Error ? e.message : String(e);
        await replyInThread({
          token,
          channel,
          threadTs,
          text: `${replies.error ?? "重试失败"}: ${err}`,
        });
        out.results.push({ task_id: taskId, outcome: "retry_error", detail: err });
      }
    }

    await updateTask(
      {
        taskJsonPath: tpath,
        reason: "step7_retry_poll_cursor",
        changedFields: ["steps.publish"],
        payload: { retry_last_polled_ts: maxTs },
        mutate: (draft) => {
          mergeStep(draft, "publish", { retry_last_polled_ts: maxTs });
        },
      },
      settings,
    );
  }

  return out;
}
