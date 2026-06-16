import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOrchestratorSlackStep4Config } from "../orchestrator/orchestratorSlackConfig.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import type { OrchestratorSettings } from "../orchestrator/types.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import { nowIsoJst } from "../orchestrator/time.js";
import { slackChatPostMessage } from "./slackClient.js";

export { slackChatPostMessage } from "./slackClient.js";
import { resolveStep4DeliveryMode } from "./step4Delivery.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type PickListTopic = {
  index: number;
  topic_id: string;
  title: string;
  source_platform: string;
  source_url?: string;
  score?: number;
};

/** Reads topic_candidates.v1 for Step4 / pick. */
export function readTopicsForPick(candidatesPath: string): PickListTopic[] {
  const raw = JSON.parse(fs.readFileSync(candidatesPath, "utf-8")) as unknown;
  if (!isObject(raw)) throw new Error(`candidate file must be an object: ${candidatesPath}`);
  const items = raw.items;
  if (!Array.isArray(items)) throw new Error(`items must be an array: ${candidatesPath}`);
  const schema = typeof raw.schema_version === "string" ? raw.schema_version : "";
  const out: PickListTopic[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!isObject(it)) continue;
    const topicId = typeof it.topic_id === "string" ? it.topic_id : "";
    if (!topicId) continue;
    const explicitIndex =
      typeof it.index === "number" && Number.isInteger(it.index) && it.index > 0 ? it.index : undefined;
    const index = explicitIndex ?? out.length + 1;
    const row: PickListTopic = {
      index,
      topic_id: topicId,
      title: typeof it.title === "string" ? it.title : "",
      source_platform: typeof it.source_platform === "string" ? it.source_platform : "",
    };
    const url =
      typeof it.source_url === "string" ? it.source_url.trim()
      : typeof it.url === "string" ? it.url.trim()
      : "";
    if (url) row.source_url = url;
    if (typeof it.score === "number" && Number.isFinite(it.score)) row.score = it.score;
    out.push(row);
  }
  if (schema === "topic_candidates.v1") {
    out.sort((a, b) => a.index - b.index);
  }
  return out;
}

function resolveCandidateFilePath(task: JsonObject, taskJsonPath?: string): string {
  const steps = task.steps && isObject(task.steps) ? task.steps : {};
  const tidy = steps.tidy && isObject(steps.tidy) ? steps.tidy : {};
  const tidyRef = typeof tidy.output_ref === "string" ? tidy.output_ref.trim() : "";
  if (!tidyRef) return "";
  if (path.isAbsolute(tidyRef)) {
    return fs.existsSync(tidyRef) ? path.resolve(tidyRef) : tidyRef;
  }
  const candidates = taskJsonPath
    ? [path.resolve(path.dirname(taskJsonPath), tidyRef), path.resolve(tidyRef)]
    : [path.resolve(tidyRef)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return tidyRef;
}

function buildSlackBody(params: {
  task_id: string;
  run_id: string;
  candidatesPath: string;
  topics: PickListTopic[];
}): string {
  const lines: string[] = [
    "*Step4 — 管理者话题选择*",
    "",
    `task_id: \`${params.task_id}\``,
    `run_id: \`${params.run_id}\``,
    `candidates: \`${params.candidatesPath}\``,
    "",
    "请在本线程回复选择，格式示例：",
    "`pick 2,5,8`",
    "若候选都不合适，也可自定义话题：",
    "`title 你想要的自定义话题`",
    "",
    "在本线程回复有效 `pick` 后，编排 run-once 将自动落盘选题（约一个调度周期内）。Step5/Step6 随后自动推进。",
    "",
    "*候选列表（编号为 1-based）：*",
    "",
  ];
  const maxLines = loadPublishOrchestratorConfig().slack.step4.max_candidates_in_message;
  const slice = params.topics.slice(0, maxLines);
  for (const t of slice) {
    const score = t.score !== undefined ? ` score=${t.score}` : "";
    lines.push(`${t.index}. [${t.source_platform}] ${t.title}${score}`);
  }
  if (params.topics.length > maxLines) {
    lines.push("", `_…共 ${params.topics.length} 条，此处仅显示前 ${maxLines} 条；完整列表见 candidates 文件。_`);
  }
  return lines.join("\n");
}

export type Step4SlackNotifyExecution =
  | {
      ok: true;
      message_ts: string;
      slack_channel: string;
      candidate_count: number;
      slack_text_preview: string;
    }
  | {
      ok: false;
      stepPatch: JsonObject;
    };

export async function executeStep4SlackNotify(
  taskJsonPath: string,
  settings: OrchestratorSettings,
): Promise<Step4SlackNotifyExecution> {
  const now = nowIsoJst();
  const task = loadTaskJson(taskJsonPath);
  const taskId = typeof task.task_id === "string" ? task.task_id : "";
  const runId = typeof task.run_id === "string" ? task.run_id : "";
  const candidatesPath = resolveCandidateFilePath(task, taskJsonPath);
  if (!candidatesPath || !fs.existsSync(candidatesPath)) {
    return {
      ok: false,
      stepPatch: {
        status: "failed",
        finished_at: now,
        error: {
          code: "STEP4_MISSING_CANDIDATES_FILE",
          message: "steps.tidy.output_ref missing or file not found",
          retryable: false,
        },
      },
    };
  }

  let topics: PickListTopic[];
  try {
    topics = readTopicsForPick(candidatesPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      stepPatch: {
        status: "failed",
        finished_at: now,
        error: {
          code: "STEP4_CANDIDATES_READ_ERROR",
          message: msg,
          retryable: false,
        },
      },
    };
  }

  if (!topics.length) {
    return {
      ok: false,
      stepPatch: {
        status: "failed",
        finished_at: now,
        error: {
          code: "STEP4_EMPTY_CANDIDATES",
          message: "candidate file has no topics with topic_id",
          retryable: false,
        },
      },
    };
  }

  const body = buildSlackBody({ task_id: taskId, run_id: runId, candidatesPath, topics });
  const preview = body.length > 800 ? `${body.slice(0, 800)}…` : body;

  const deliveryMode = resolveStep4DeliveryMode();

  if (deliveryMode === "dry_run") {
    // eslint-disable-next-line no-console
    console.log("[Step4 DRY_RUN] Slack message body:\n", body);
    return {
      ok: true,
      message_ts: "dry_run",
      slack_channel: "dry_run",
      candidate_count: topics.length,
      slack_text_preview: preview,
    };
  }

  let slackCfg: ReturnType<typeof loadOrchestratorSlackStep4Config>;
  try {
    slackCfg = loadOrchestratorSlackStep4Config(settings, { requireSlackBotToken: deliveryMode === "node" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      stepPatch: {
        status: "failed",
        finished_at: now,
        error: {
          code: "STEP4_CONFIG_ERROR",
          message: msg,
          retryable: false,
        },
      },
    };
  }

  const post = await slackChatPostMessage({
    token: slackCfg.botToken,
    channel: slackCfg.slack.channelId,
    text: body,
  });
  if (!post.ok || !post.ts) {
    return {
      ok: false,
      stepPatch: {
        status: "failed",
        finished_at: now,
        error: {
          code: "STEP4_SLACK_POST_FAILED",
          message: post.error ?? "chat.postMessage failed",
          retryable: true,
        },
      },
    };
  }

  return {
    ok: true,
    message_ts: post.ts,
    slack_channel: slackCfg.slack.channelId,
    candidate_count: topics.length,
    slack_text_preview: preview,
  };
}

export function resolveCandidatePickSourcePath(taskJsonPath: string): string {
  const task = loadTaskJson(taskJsonPath);
  const p = resolveCandidateFilePath(task);
  if (!p) throw new Error("steps.tidy.output_ref is missing");
  return path.isAbsolute(p) ? p : path.resolve(path.dirname(taskJsonPath), p);
}
