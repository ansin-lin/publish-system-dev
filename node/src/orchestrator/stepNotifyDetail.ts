import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import type { PlatformId, PublishResult } from "../shared/types.js";
import { MISSING_POST_URL_REASON } from "../shared/missingPostUrl.js";
import { rowIsHardFailure, type PlatformResultRow } from "../step7-publish/publishVerification.js";
import type { StockImageSource } from "../step6-generate/stockImagePool.js";
import { loadTaskJson } from "./taskStore.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepOutputRef(task: JsonObject, stepName: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const ref = step.output_ref;
  return typeof ref === "string" ? ref.trim() : "";
}

function readJsonFile(filePath: string): JsonObject | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return isObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

function truncate(text: string, max = 120): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

const PLATFORM_LABELS: Record<PlatformId, string> = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  xiaohongshu: "小红书",
  youtube: "YouTube",
  tiktok: "TikTok",
};

function platformLabel(platform: string): string {
  if (platform in PLATFORM_LABELS) return PLATFORM_LABELS[platform as PlatformId];
  return platform;
}

/** Sum title+body length across all platform drafts (single-topic copy_result). */
export function countCopyCharacters(copyPath: string): number {
  const doc = readJsonFile(copyPath);
  if (!doc) return 0;
  const items = doc.items;
  if (!Array.isArray(items) || items.length === 0) return 0;
  const row = items[0];
  if (!isObject(row)) return 0;
  const drafts = row.drafts;
  if (!Array.isArray(drafts)) return 0;
  let total = 0;
  for (const d of drafts) {
    if (!isObject(d)) continue;
    const body = typeof d.body === "string" ? d.body : "";
    const title = typeof d.title === "string" ? d.title : "";
    total += body.length + title.length;
  }
  return total;
}

/** Slack 用：今日 / 通用 / AI生成 */
export function formatImageSourceLabel(source: StockImageSource | "ai_generated" | null | undefined): string {
  if (source === "stock_today") return "今日";
  if (source === "stock_common") return "通用";
  return "AI生成";
}

export function formatStep6NotifyDetail(params: {
  copyPath: string;
  imageCount: number;
  imageSource: StockImageSource | "ai_generated" | null | undefined;
}): string {
  const chars = countCopyCharacters(params.copyPath);
  const sourceLabel = formatImageSourceLabel(params.imageSource);
  return [`文案 ${chars} 字`, `图片 ${params.imageCount} 张`, `图片来源：${sourceLabel}`].join(" | ");
}

const VIDEO_SKIP_REASON = "未配置视频素材（已查当日目录与 Common，仅 .mp4）";

export function formatStep7VideoSkippedLines(skippedPlatforms: PlatformId[]): string {
  if (skippedPlatforms.length === 0) return "";
  const names = skippedPlatforms.map((p) => platformLabel(p)).join("、");
  return `*视频：*${VIDEO_SKIP_REASON} — ${names} 未发布`;
}

function formatStep7RetryHint(rows?: PlatformResultRow[]): string {
  const hasRetryable =
    rows && rows.length > 0 ?
      rows.some((r) => rowIsHardFailure(r))
    : true;
  if (!hasRetryable) return "";
  return "\n失败平台可在本线程回复：`retry facebook` 或 `retry 小红书`";
}

export function formatStep7PublishNotifyDetail(
  results: PublishResult[],
  options?: { videoSkippedPlatforms?: PlatformId[]; platformRows?: JsonObject[] },
): string {
  const parts: string[] = [];
  const skipped = options?.videoSkippedPlatforms ?? [];
  const videoLine = formatStep7VideoSkippedLines(skipped);
  if (videoLine) parts.push(videoLine);
  const rows = options?.platformRows;
  if (rows && rows.length > 0) {
    parts.push(formatStep7PlatformLinesFromRows(rows));
    const hint = formatStep7RetryHint(rows);
    if (hint) parts.push(hint);
  } else {
    parts.push(formatStep7PlatformLines(results));
    const hint = formatStep7RetryHint();
    if (hint) parts.push(hint);
  }
  return parts.join("\n");
}

function formatValidatedLine(name: string, reason?: string, publishedAt?: string): string {
  if (reason === MISSING_POST_URL_REASON || publishedAt) {
    return `• ${name}：成功（未抓取 post_url）`;
  }
  return `• ${name}：校验通过（未正式发布）`;
}

export function formatStep7PlatformLinesFromRows(rows: JsonObject[]): string {
  if (rows.length === 0) return "无平台发布结果";
  const lines: string[] = ["*各平台结果：*"];
  for (const row of rows) {
    const platform = typeof row.platform === "string" ? row.platform : "unknown";
    const name = platformLabel(platform);
    const status = typeof row.status === "string" ? row.status : "";
    const verified = row.verified === true;
    if (status === "published" && verified) {
      lines.push(`• ${name}：成功（已校验）`);
      continue;
    }
    if (status === "published" && !verified) {
      lines.push(`• ${name}：失败（校验未通过）`);
      continue;
    }
    if (status === "validated") {
      const note = typeof row.verification_note === "string" ? row.verification_note : "";
      const publishedAt = typeof row.published_at === "string" ? row.published_at : undefined;
      lines.push(formatValidatedLine(name, note, publishedAt));
      continue;
    }
    if (status === "auth_expired") {
      lines.push(`• ${name}：失败（登录态失效）`);
      continue;
    }
    if (status === "skipped") {
      lines.push(`• ${name}：跳过`);
      continue;
    }
    if (status === "failed" || status === "manual_required") {
      lines.push(`• ${name}：失败（未知问题）`);
      continue;
    }
    lines.push(`• ${name}：${status || "unknown"}`);
  }
  return lines.join("\n");
}

export function formatStep7PlatformLines(results: PublishResult[]): string {
  if (results.length === 0) return "无平台发布结果";
  const lines: string[] = ["*各平台结果：*"];
  for (const r of results) {
    const name = platformLabel(r.platform);
    if (r.status === "published") {
      lines.push(`• ${name}：成功（已校验）`);
      continue;
    }
    if (r.status === "validated") {
      lines.push(formatValidatedLine(name, r.reason, r.published_at));
      continue;
    }
    if (r.status === "auth_expired") {
      lines.push(`• ${name}：失败（登录态失效）`);
      continue;
    }
    if (r.status === "skipped") {
      lines.push(`• ${name}：跳过`);
      continue;
    }
    if (r.status === "failed" || r.status === "manual_required") {
      lines.push(`• ${name}：失败（未知问题）`);
      continue;
    }
    lines.push(`• ${name}：${r.status}`);
  }
  return lines.join("\n");
}

export function formatStep7LaunchFailure(_message: string, platforms: PlatformId[]): string {
  const names = platforms.map((p) => platformLabel(p)).join("、") || "全部平台";
  return [`*各平台结果：*`, `• ${names}：失败（未知问题）`].join("\n");
}

export function buildStep2NotifyDetail(taskJsonPath: string): string {
  const task = loadTaskJson(taskJsonPath);
  const doc = readJsonFile(stepOutputRef(task, "collect"));
  const items = doc?.items;
  const n = Array.isArray(items) ? items.length : 0;
  const degraded = task.degraded === true ? "（部分源降级）" : "";
  return `采集 ${n} 条${degraded}`;
}

export function buildStep3NotifyDetail(taskJsonPath: string): string {
  const task = loadTaskJson(taskJsonPath);
  const doc = readJsonFile(stepOutputRef(task, "tidy"));
  const items = doc?.items;
  const n = Array.isArray(items) ? items.length : 0;
  return `候选话题 ${n} 条`;
}

export function buildStep1NotifyDetail(): string {
  return "任务目录已创建，进入话题采集";
}
