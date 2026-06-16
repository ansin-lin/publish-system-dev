import type { PlatformId, PublishArtifacts, PublishResult } from "./types.js";
import { nowIso } from "./time.js";

export const MISSING_POST_URL_REASON = "发帖流程已完成，未抓取到 post_url";

export function resolveRequirePostUrl(explicit: boolean | undefined, fallback = true): boolean {
  return explicit ?? fallback;
}

export function missingPostUrlResult(params: {
  requirePostUrl: boolean;
  platform: PlatformId;
  profile: string;
  task_id: string;
  publish_id: string;
  artifacts: PublishArtifacts;
  platformLabel: string;
}): PublishResult {
  const base = {
    platform: params.platform,
    profile: params.profile,
    task_id: params.task_id,
    publish_id: params.publish_id,
    artifacts: params.artifacts,
  };
  if (!params.requirePostUrl) {
    return {
      ...base,
      status: "validated",
      reason: MISSING_POST_URL_REASON,
      published_at: nowIso(),
    };
  }
  return {
    ...base,
    status: "failed",
    error: `${params.platformLabel} 发帖后未获取 post_url`,
  };
}
