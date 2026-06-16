import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { facebookUrlFailsValidation } from "../shared/facebookPostUrl.js";
import type { PlatformId, PublishResult } from "../shared/types.js";

export type PublishValidationMode = "strict" | "balanced" | "loose";

export type PublishVerificationConfig = {
  /** @deprecated use mode; true → strict */
  strict?: boolean;
  mode?: PublishValidationMode;
  /** false 时 published 缺 post_url 不降级为 failed（平台层通常已返回 validated） */
  require_post_url?: boolean;
};

export type PlatformResultRow = JsonObject;

function resolveValidationMode(config: PublishVerificationConfig): PublishValidationMode {
  if (config.mode === "strict" || config.mode === "balanced" || config.mode === "loose") {
    return config.mode;
  }
  return config.strict === false ? "loose" : "strict";
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function verifyPublished(
  result: Extract<PublishResult, { status: "published" }>,
  mode: PublishValidationMode,
  requirePostUrl: boolean,
): { result: PublishResult; verified: boolean; matched?: boolean; post_id_checked?: boolean; note?: string } {
  if (mode === "loose") {
    return { result, verified: true, matched: true, post_id_checked: true };
  }

  if (result.platform === "x") {
    const postId = result.post_id?.trim();
    if (!postId) {
      return {
        result: {
          status: "failed",
          platform: result.platform,
          profile: result.profile,
          task_id: result.task_id,
          publish_id: result.publish_id,
          error: "X 发帖缺少 post_id",
          artifacts: result.artifacts,
        },
        verified: false,
        post_id_checked: false,
        note: "x_missing_post_id",
      };
    }
    if (mode === "balanced") {
      return {
        result,
        verified: true,
        matched: true,
        post_id_checked: true,
        note: "x_balanced_post_id_ok",
      };
    }
    // strict: require platform-layer body match — only fails if publish returned failed
    return { result, verified: true, matched: true, post_id_checked: true };
  }

  if (result.platform === "facebook") {
    const url = result.post_url?.trim();
    if (!url) {
      if (!requirePostUrl) {
        return {
          result: {
            status: "validated",
            platform: result.platform,
            profile: result.profile,
            task_id: result.task_id,
            publish_id: result.publish_id,
            reason: "发帖流程已完成，未抓取到 post_url",
            published_at: result.published_at,
            artifacts: result.artifacts,
          },
          verified: false,
          note: "facebook_missing_url_validated",
        };
      }
      return {
        result: {
          status: "failed",
          platform: result.platform,
          profile: result.profile,
          task_id: result.task_id,
          publish_id: result.publish_id,
          error: "Facebook 发帖后未获取 post_url",
          artifacts: result.artifacts,
        },
        verified: false,
        note: "facebook_missing_url",
      };
    }
    const bad = facebookUrlFailsValidation(url, mode);
    if (bad) {
      return {
        result: {
          status: "failed",
          platform: result.platform,
          profile: result.profile,
          task_id: result.task_id,
          publish_id: result.publish_id,
          error: `Facebook 回执校验失败: ${bad} (${url})`,
          artifacts: result.artifacts,
        },
        verified: false,
        note: "facebook_bad_url",
      };
    }
    return { result, verified: true };
  }

  if (result.platform === "instagram") {
    if (!result.post_url?.trim()) {
      if (!requirePostUrl) {
        return {
          result: {
            status: "validated",
            platform: result.platform,
            profile: result.profile,
            task_id: result.task_id,
            publish_id: result.publish_id,
            reason: "发帖流程已完成，未抓取到 post_url",
            published_at: result.published_at,
            artifacts: result.artifacts,
          },
          verified: false,
          note: "instagram_missing_url_validated",
        };
      }
      return {
        result: {
          status: "failed",
          platform: result.platform,
          profile: result.profile,
          task_id: result.task_id,
          publish_id: result.publish_id,
          error: "Instagram 发帖后未获取 post_url / 成功信号",
          artifacts: result.artifacts,
        },
        verified: false,
        note: "instagram_missing_url",
      };
    }
    return { result, verified: true };
  }

  if (result.platform === "xiaohongshu") {
    // 笔记需审核后才可能有公开 URL；跳到创作者后台成功页即视为提交成功
    return {
      result,
      verified: true,
      note: "xhs_submit_success_pending_review",
    };
  }

  return { result, verified: true };
}

export function verifyPublishResult(
  result: PublishResult,
  config: PublishVerificationConfig,
): { result: PublishResult; row: PlatformResultRow } {
  const mode = resolveValidationMode(config);
  const requirePostUrl = config.require_post_url ?? mode === "strict";
  if (result.status !== "published") {
    return { result, row: buildPlatformResultRow(result, { verified: false }) };
  }
  const checked = verifyPublished(result, mode, requirePostUrl);
  const meta: {
    verified: boolean;
    matched?: boolean;
    post_id_checked?: boolean;
    verification_note?: string;
  } = { verified: checked.verified };
  if (checked.matched !== undefined) meta.matched = checked.matched;
  if (checked.post_id_checked !== undefined) meta.post_id_checked = checked.post_id_checked;
  if (checked.note) meta.verification_note = checked.note;
  return {
    result: checked.result,
    row: buildPlatformResultRow(checked.result, meta),
  };
}

export function buildPlatformResultRow(
  result: PublishResult,
  meta: { verified: boolean; matched?: boolean; post_id_checked?: boolean; verification_note?: string },
): PlatformResultRow {
  const base: PlatformResultRow = {
    platform: result.platform,
    profile: result.profile,
    status: result.status,
    verified: meta.verified,
  };
  if (meta.matched !== undefined) base.matched = meta.matched;
  if (meta.post_id_checked !== undefined) base.post_id_checked = meta.post_id_checked;
  if (meta.verification_note) base.verification_note = meta.verification_note;

  if (result.status === "published") {
    base.published_at = result.published_at;
    if (result.post_url) base.post_url = result.post_url;
    if (result.post_id) base.post_id = result.post_id;
  } else if (result.status === "validated") {
    base.verified = false;
    if (result.post_url) base.post_url = result.post_url;
    if (result.published_at) base.published_at = result.published_at;
    if (result.reason) base.verification_note = result.reason;
  } else if (result.status === "skipped") {
    base.reason = result.reason;
  } else if (result.status === "auth_expired") {
    base.reason = result.reason;
  } else {
    base.error = "error" in result ? result.error : "unknown";
  }
  return base;
}

export function rowCountsAsVerifiedSuccess(row: PlatformResultRow): boolean {
  return row.status === "published" && row.verified === true;
}

export function rowIsHardFailure(row: PlatformResultRow): boolean {
  if (row.status === "failed" || row.status === "auth_expired" || row.status === "manual_required") {
    return true;
  }
  if (row.status === "published" && row.verified !== true) return true;
  return false;
}

export function summarizeTerminalFromRows(
  rows: PlatformResultRow[],
): "published" | "publish_partial_failed" | "failed" {
  if (rows.length === 0) return "failed";
  const verifiedOk = rows.filter((r) => rowCountsAsVerifiedSuccess(r)).length;
  const validated = rows.filter((r) => r.status === "validated").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const hardFail = rows.filter((r) => rowIsHardFailure(r)).length;
  const okSlots = verifiedOk + validated + skipped;
  if (okSlots === rows.length && hardFail === 0) return "published";
  if (verifiedOk + validated > 0 && hardFail > 0) return "publish_partial_failed";
  if (verifiedOk + validated > 0) return "published";
  return "failed";
}

export function buildPublishSummary(rows: PlatformResultRow[]): JsonObject {
  const verifiedPublished = rows.filter((r) => rowCountsAsVerifiedSuccess(r)).length;
  const falseSuccess = rows.filter((r) => r.status === "published" && r.verified !== true).length;
  const validated = rows.filter((r) => r.status === "validated").length;
  const failed = rows.filter((r) => rowIsHardFailure(r)).length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  return {
    status: summarizeTerminalFromRows(rows),
    published_count: verifiedPublished,
    verified_published_count: verifiedPublished,
    false_success_count: falseSuccess,
    validated_count: validated,
    failed_count: failed,
    skipped_count: skipped,
    total: rows.length,
  };
}

export function applyVerificationToResults(
  results: PublishResult[],
  config: PublishVerificationConfig,
): { results: PublishResult[]; rows: PlatformResultRow[] } {
  const outResults: PublishResult[] = [];
  const rows: PlatformResultRow[] = [];
  for (const r of results) {
    const { result, row } = verifyPublishResult(r, config);
    outResults.push(result);
    rows.push(row);
  }
  return { results: outResults, rows };
}

export function parsePlatformRowsFromTask(task: JsonObject, publishResultPath?: string): PlatformResultRow[] {
  const steps = task.steps;
  if (!isObject(steps)) return [];
  const publish = steps.publish;
  if (!isObject(publish)) return [];
  const embedded = publish.platform_results;
  if (Array.isArray(embedded)) {
    return embedded.filter(isObject) as PlatformResultRow[];
  }
  if (publishResultPath) {
    try {
      const raw = JSON.parse(fs.readFileSync(publishResultPath, "utf-8")) as unknown;
      if (isObject(raw) && Array.isArray(raw.platform_results)) {
        return raw.platform_results.filter(isObject) as PlatformResultRow[];
      }
    } catch {
      // ignore
    }
  }
  return [];
}
