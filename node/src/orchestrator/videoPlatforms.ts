import type { PlatformId } from "../shared/types.js";
import { isPlatformId } from "../shared/types.js";
import { loadPublishOrchestratorConfig } from "./publishOrchestratorConfig.js";
import { pickStockVideo, type StockVideoPickResult } from "../step6-generate/stockVideoPool.js";

export function isVideoPublishPlatform(platformId: string): boolean {
  const cfg = loadPublishOrchestratorConfig();
  const def = cfg.platforms.definitions[platformId];
  return Boolean(def?.capabilities.video);
}

/** Platforms in publish_enabled with capabilities.video (e.g. youtube, tiktok). */
export function listVideoPublishPlatformIds(): PlatformId[] {
  const cfg = loadPublishOrchestratorConfig();
  return cfg.platforms.publish_enabled.filter((id): id is PlatformId => {
    if (!isPlatformId(id)) return false;
    return isVideoPublishPlatform(id);
  });
}

/** Image/post platforms in publish_enabled (not video-only). */
export function listImagePublishPlatformIds(): PlatformId[] {
  const cfg = loadPublishOrchestratorConfig();
  return cfg.platforms.publish_enabled.filter((id): id is PlatformId => {
    if (!isPlatformId(id)) return false;
    return !isVideoPublishPlatform(id);
  });
}

/** copy_required minus video platforms; video platforms only when stock video exists. */
export function resolveCopyPlatformsForTask(params: {
  taskId: string;
  runId: string;
}): { platforms: PlatformId[]; videoPick: StockVideoPickResult | null } {
  const cfg = loadPublishOrchestratorConfig();
  const videoIds = listVideoPublishPlatformIds();
  const videoSet = new Set(videoIds);
  const staticCopy = cfg.platforms.copy_required.filter((id): id is PlatformId => {
    return isPlatformId(id) && !videoSet.has(id);
  });

  const videoPick = pickStockVideo({ taskId: params.taskId, runId: params.runId });
  const platforms = videoPick ? [...staticCopy, ...videoIds] : staticCopy;
  return { platforms, videoPick };
}
