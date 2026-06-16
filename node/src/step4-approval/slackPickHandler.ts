import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSlackStep4Config } from "../orchestrator/orchestratorSlackConfig.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import { mergeStep } from "../orchestrator/taskMutations.js";
import { ageMsSinceIsoJst, nowIsoJst } from "../orchestrator/time.js";
import { updateTask } from "../orchestrator/updateTask.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { parsePickIndices } from "./applyPick.js";
import { completeStep4Pick } from "./pipeline.js";
import { resolveStep4DeliveryMode } from "./step4Delivery.js";
import { appendStep4SlackLog } from "./step4SlackLog.js";
import { slackChatPostMessage } from "./slackClient.js";
import {
  fetchThreadReplies,
  isPickCommandText,
  isSelectionCommandText,
  maxSlackTs,
  selectNewHumanPickCandidates,
  type SlackReplyRow,
} from "./slackPickPoll.js";

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
    appendStep4SlackLog("thread_reply_failed", {
      channel: params.channel,
      thread_ts: params.threadTs,
      error: post.error,
    });
  }
}

async function setLastPolledTs(
  taskJsonPath: string,
  lastPolledTs: string,
  settings: OrchestratorSettings,
): Promise<void> {
  await updateTask(
    {
      taskJsonPath,
      reason: "step4_slack_poll_cursor",
      changedFields: ["steps.approval"],
      payload: { last_polled_ts: lastPolledTs },
      mutate: (draft) => {
        mergeStep(draft, "approval", { last_polled_ts: lastPolledTs });
      },
    },
    settings,
  );
}

async function applyApprovalTimeout(
  taskJsonPath: string,
  settings: OrchestratorSettings,
  now: string,
): Promise<void> {
  await updateTask(
    {
      taskJsonPath,
      reason: "step4_pick_timeout",
      changedFields: ["status", "steps.approval"],
      payload: {},
      mutate: (draft) => {
        draft.status = "approval_timeout";
        mergeStep(draft, "approval", {
          status: "failed",
          finished_at: now,
          error: {
            code: "STEP4_PICK_TIMEOUT",
            message: "Manager did not pick within pick_timeout_hours",
            retryable: false,
          },
        });
      },
    },
    settings,
  );
  appendStep4SlackLog("pick_timeout", { task_json: taskJsonPath });
}

export type PollTaskPickResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "timeout" }
  | { outcome: "poll_error"; error: string }
  | { outcome: "no_new_messages" }
  | { outcome: "cursor_advanced" }
  | { outcome: "pick_applied"; task_id: string }
  | { outcome: "pick_error"; error: string; replied: boolean };

async function processPickMessage(params: {
  taskJsonPath: string;
  taskId: string;
  message: SlackReplyRow;
  settings: OrchestratorSettings;
  token: string;
  channel: string;
  threadTs: string;
  allowedUserIds: string[];
  replies: ReturnType<typeof loadPublishOrchestratorConfig>["slack"]["step4"]["pick_receive"]["replies"];
}): Promise<"applied" | "error_replied" | "ignored"> {
  const { message, replies } = params;
  const text = message.text.trim();

  if (!isSelectionCommandText(text)) return "ignored";

  if (params.allowedUserIds.length && !params.allowedUserIds.includes(message.user)) {
    await replyInThread({
      token: params.token,
      channel: params.channel,
      threadTs: params.threadTs,
      text: replies.unauthorized,
    });
    appendStep4SlackLog("pick_unauthorized", {
      task_id: params.taskId,
      user: message.user,
    });
    return "error_replied";
  }

  if (isPickCommandText(text)) {
    try {
      parsePickIndices(text);
    } catch {
      await replyInThread({
        token: params.token,
        channel: params.channel,
        threadTs: params.threadTs,
        text: replies.invalid_pick,
      });
      return "error_replied";
    }
  } else {
    // title branch: validate minimal length to avoid accidental triggers like `title x`
    const m = text.match(/^title\s+([\s\S]+)$/i);
    const title = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (!title || title.length < 8 || title.length > 120) {
      await replyInThread({
        token: params.token,
        channel: params.channel,
        threadTs: params.threadTs,
        text: replies.custom_invalid,
      });
      return "error_replied";
    }
  }

  try {
    const result = await completeStep4Pick({
      taskJsonPath: params.taskJsonPath,
      rawInput: text,
      operator: message.user,
      settings: params.settings,
      advancePipeline: false,
    });
    const confirm =
      result.alreadySelected ?
        (result.userMessage ?? replies.already_selected)
      : isPickCommandText(text) ? replies.success
      : replies.custom_success;
    await replyInThread({
      token: params.token,
      channel: params.channel,
      threadTs: params.threadTs,
      text: confirm,
    });
    appendStep4SlackLog("pick_applied", {
      task_id: params.taskId,
      user: message.user,
      already_selected: Boolean(result.alreadySelected),
    });
    return "applied";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("out of range") || msg.includes("Index ")) {
      await replyInThread({
        token: params.token,
        channel: params.channel,
        threadTs: params.threadTs,
        text: replies.out_of_range,
      });
      return "error_replied";
    }
    if (msg.includes("not in allowed_slack_user_ids")) {
      await replyInThread({
        token: params.token,
        channel: params.channel,
        threadTs: params.threadTs,
        text: replies.unauthorized,
      });
      return "error_replied";
    }
    if (msg.toLowerCase().includes("title is too short") || msg.toLowerCase().includes("title is too long")) {
      await replyInThread({
        token: params.token,
        channel: params.channel,
        threadTs: params.threadTs,
        text: replies.custom_invalid,
      });
      return "error_replied";
    }
    appendStep4SlackLog("pick_failed", { task_id: params.taskId, error: msg });
    return "error_replied";
  }
}

/**
 * Poll one awaiting_manager_selection task for Slack pick replies.
 */
export async function pollTaskSlackPick(
  taskJsonPath: string,
  settings: OrchestratorSettings,
): Promise<PollTaskPickResult> {
  const cfg = loadPublishOrchestratorConfig();
  if (cfg.slack.step4.pick_receive.mode !== "poll") {
    return { outcome: "skipped", reason: "pick_receive.mode is not poll" };
  }
  if (resolveStep4DeliveryMode() === "dry_run" || cfg.slack.step4.dry_run) {
    return { outcome: "skipped", reason: "step4 dry_run" };
  }

  const task = loadTaskJson(taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";
  const taskId = typeof task.task_id === "string" ? task.task_id : "";

  if (status !== "awaiting_manager_selection") {
    return { outcome: "skipped", reason: `status=${status}` };
  }
  if (stepStatus(task, "approval") !== "running") {
    return { outcome: "skipped", reason: `approval=${stepStatus(task, "approval")}` };
  }

  const timeoutHours = cfg.slack.step4.pick_receive.pick_timeout_hours;
  const startedAt = stepField(task, "approval", "started_at");
  const ageMs = ageMsSinceIsoJst(startedAt);
  if (ageMs !== null && ageMs > timeoutHours * 3_600_000) {
    await applyApprovalTimeout(taskJsonPath, settings, nowIsoJst());
    return { outcome: "timeout" };
  }

  const threadTs =
    stepField(task, "approval", "slack_thread_ts") ||
    stepField(task, "approval", "message_ts");
  if (!threadTs) {
    return { outcome: "skipped", reason: "missing slack_thread_ts/message_ts" };
  }

  let slackCfg: ReturnType<typeof loadOrchestratorSlackStep4Config>;
  try {
    slackCfg = loadOrchestratorSlackStep4Config(settings, {
      requireSlackBotToken: true,
      requireSlackChannel: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { outcome: "poll_error", error: msg };
  }

  const channel = stepField(task, "approval", "slack_channel") || slackCfg.slack.channelId;
  const replies = cfg.slack.step4.pick_receive.replies;

  const fetched = await fetchThreadReplies({
    token: slackCfg.botToken,
    channel,
    threadTs,
  });
  if (!fetched.ok) {
    appendStep4SlackLog("replies_fetch_failed", { task_id: taskId, error: fetched.error });
    return { outcome: "poll_error", error: fetched.error };
  }

  const lastPolledTs = stepField(task, "approval", "last_polled_ts") || undefined;
  const rootTs = stepField(task, "approval", "message_ts") || threadTs;
  const candidates = selectNewHumanPickCandidates({
    messages: fetched.messages,
    threadTs,
    lastPolledTs,
    rootMessageTs: rootTs,
  });

  if (!candidates.length) {
    return { outcome: "no_new_messages" };
  }

  let maxTs = lastPolledTs ?? rootTs;
  for (const m of candidates) {
    maxTs = maxSlackTs(maxTs, m.ts);
  }

  const allowed = slackCfg.slack.allowedSlackUserIds;

  for (const message of candidates) {
    if (!isSelectionCommandText(message.text)) continue;
    const pickResult = await processPickMessage({
      taskJsonPath,
      taskId,
      message,
      settings,
      token: slackCfg.botToken,
      channel,
      threadTs,
      allowedUserIds: allowed,
      replies,
    });
    if (pickResult === "applied") {
      // Pick moves task to topics_selected; no cursor bump (avoids extra revision / outbox noise).
      return { outcome: "pick_applied", task_id: taskId };
    }
  }

  await setLastPolledTs(taskJsonPath, maxTs, settings);
  const hadPickErrors = candidates.some((m) => isSelectionCommandText(m.text));
  if (hadPickErrors) {
    return { outcome: "pick_error", error: "pick command rejected", replied: true };
  }
  return { outcome: "cursor_advanced" };
}
