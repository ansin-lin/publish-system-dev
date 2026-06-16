import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import type { JobJson, JobTarget, PlatformId, PlatformPayload, PublishMode } from "../shared/types.js";
import { isPlatformId } from "../shared/types.js";
import { resolvePublishHeadless } from "../step7-publish/publish/headless.js";
import {
  getCopyPlatformAliases,
  loadPublishOrchestratorConfig,
} from "../orchestrator/publishOrchestratorConfig.js";
import { listImagePublishPlatformIds, listVideoPublishPlatformIds } from "../orchestrator/videoPlatforms.js";
import { yyyymmddJst } from "../orchestrator/time.js";
import { pickStockVideo, type StockVideoPickResult } from "./stockVideoPool.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slotSortKey(slotId: string): number {
  const m = /^img_(\d+)$/i.exec(slotId.trim());
  return m ? Number.parseInt(m[1]!, 10) : 999;
}

export type BuildPublishJobParams = {
  taskId: string;
  runId: string;
  copyPath: string;
  imagePath: string;
  publishDir: string;
  /** 只包含这些平台；未设置则使用 publish_enabled */
  platformFilter?: PlatformId[];
  /** 默认有界面；true 为无头 */
  headless?: boolean;
};

export type BuildPublishJobResult = {
  jobPath: string;
  job: JobJson;
  publishId: string;
  topicId: string;
  imagePaths: string[];
  platforms: PlatformId[];
  /** 配置为视频平台但因未配置视频素材而未加入 job.targets */
  videoSkippedPlatforms: PlatformId[];
  videoPick: StockVideoPickResult | null;
};

type CopyDraft = {
  platform: PlatformId;
  title: string;
  body: string;
  tags: string[];
};

function normalizeDraftPlatform(raw: unknown): PlatformId | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const key = raw.trim().toLowerCase();
  const allowed = new Set([
    ...listImagePublishPlatformIds(),
    ...listVideoPublishPlatformIds(),
  ]);
  if (isPlatformId(key) && allowed.has(key)) return key;
  const aliases = getCopyPlatformAliases();
  const mapped = aliases[key] ?? aliases[raw.trim()];
  if (mapped && isPlatformId(mapped) && allowed.has(mapped)) return mapped;
  return null;
}

function loadCopyDrafts(copyPath: string): { topicId: string; drafts: CopyDraft[] } {
  const raw = JSON.parse(fs.readFileSync(copyPath, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("copy_result must be a JSON object");
  const items = raw.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("copy_result.items is empty");
  }
  const row = items[0];
  if (!isObject(row)) throw new Error("copy_result.items[0] invalid");
  const topicId = typeof row.topic_id === "string" ? row.topic_id.trim() : "";
  if (!topicId) throw new Error("copy_result missing topic_id");

  const draftsRaw = row.drafts;
  if (!Array.isArray(draftsRaw) || draftsRaw.length === 0) {
    throw new Error("copy_result.items[0].drafts is empty");
  }

  const drafts: CopyDraft[] = [];
  for (const d of draftsRaw) {
    if (!isObject(d)) continue;
    const platform = normalizeDraftPlatform(d.platform);
    if (!platform) continue;
    const body = typeof d.body === "string" ? d.body.trim() : "";
    const title = typeof d.title === "string" ? d.title.trim() : "";
    const tags = Array.isArray(d.tags) ?
      d.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
    drafts.push({ platform, title, body, tags });
  }

  if (drafts.length === 0) {
    throw new Error("copy_result has no publish platform drafts");
  }

  return { topicId, drafts };
}

function loadSuccessImagePaths(imagePath: string): string[] {
  const raw = JSON.parse(fs.readFileSync(imagePath, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("image_result must be a JSON object");
  const images = raw.images;
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("image_result.images is empty");
  }

  const rows: { slot_id: string; asset_path: string }[] = [];
  for (const img of images) {
    if (!isObject(img)) continue;
    if (img.status !== "success") continue;
    const asset_path = typeof img.asset_path === "string" ? img.asset_path.trim() : "";
    if (!asset_path || !fs.existsSync(asset_path)) {
      throw new Error(`image_result asset missing on disk: ${asset_path || "(empty)"}`);
    }
    const slot_id = typeof img.slot_id === "string" && img.slot_id.trim() ? img.slot_id.trim() : `img_${rows.length + 1}`;
    rows.push({ slot_id, asset_path: path.resolve(asset_path) });
  }

  if (rows.length === 0) {
    throw new Error("image_result has no successful images with asset_path");
  }

  rows.sort((a, b) => slotSortKey(a.slot_id) - slotSortKey(b.slot_id));
  return rows.map((r) => r.asset_path);
}

function writeVideoPickArtifact(
  publishDir: string,
  taskId: string,
  runId: string,
  pick: StockVideoPickResult | null,
): string | null {
  if (!pick) return null;
  const datePart = yyyymmddJst();
  const pickPath = path.resolve(publishDir, `video_pick_${datePart}_${runId}.json`);
  fs.writeFileSync(
    pickPath,
    JSON.stringify(
      {
        schema_version: "video_pick.v1",
        task_id: taskId,
        run_id: runId,
        source: pick.source,
        asset_path: pick.path,
        pool_dir: pick.poolDir,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return pickPath;
}

/**
 * 将 Step6 的 copy_result + image_result 转为发布器 JobJson，并落盘到 task/publish/。
 */
export function buildPublishJobFromStep6(params: BuildPublishJobParams): BuildPublishJobResult {
  const { taskId, runId, copyPath, imagePath, publishDir } = params;
  if (!fs.existsSync(copyPath)) throw new Error(`copy_result not found: ${copyPath}`);
  if (!fs.existsSync(imagePath)) throw new Error(`image_result not found: ${imagePath}`);

  const { topicId, drafts } = loadCopyDrafts(copyPath);
  const imagePaths = loadSuccessImagePaths(imagePath);
  const draftByPlatform = new Map(drafts.map((d) => [d.platform, d]));

  const orch = loadPublishOrchestratorConfig();
  const wantFilter = params.platformFilter?.length ? new Set(params.platformFilter) : null;

  const imagePlatformIds = listImagePublishPlatformIds().filter((id) => !wantFilter || wantFilter.has(id));
  const videoPlatformIds = listVideoPublishPlatformIds().filter((id) => !wantFilter || wantFilter.has(id));

  // Stock video is optional. Special rule: if a stock video exists, Instagram publishes as video+caption.
  const videoPick = pickStockVideo({ taskId, runId });
  const absVideo = videoPick ? path.resolve(videoPick.path) : null;
  if (absVideo && !fs.existsSync(absVideo)) {
    throw new Error(`stock video file missing on disk: ${absVideo}`);
  }
  const videoSkippedPlatforms: PlatformId[] = [];
  const targets: JobTarget[] = [];
  const payloads: Partial<Record<PlatformId | "default", PlatformPayload>> = {
    default: { images: imagePaths },
  };

  for (const platform of imagePlatformIds) {
    const draft = draftByPlatform.get(platform);
    if (!draft) {
      throw new Error(`copy_result missing draft for image platform: ${platform}`);
    }
    const content: PlatformPayload["content"] = { body: draft.body };
    if (draft.title) content.title = draft.title;
    if (draft.tags.length > 0) content.tags = draft.tags;
    if (platform === "instagram" && absVideo) {
      payloads[platform] = { content, video: absVideo };
      targets.push({ platform, profile: "default", mode: "video" satisfies PublishMode });
    } else {
      payloads[platform] = { content };
      targets.push({ platform, profile: "default", mode: "post" satisfies PublishMode });
    }
  }

  if (absVideo) {
    for (const platform of videoPlatformIds) {
      const draft = draftByPlatform.get(platform);
      if (!draft) {
        throw new Error(`copy_result missing draft for video platform: ${platform}`);
      }
      if (platform === "youtube" && !draft.body.trim()) {
        throw new Error("copy_result youtube body must be non-empty when publishing video");
      }
      const content: PlatformPayload["content"] = { body: draft.body };
      if (draft.title) content.title = draft.title;
      if (draft.tags.length > 0) content.tags = draft.tags;
      payloads[platform] = { content, video: absVideo };
      targets.push({ platform, profile: "default", mode: "video" satisfies PublishMode });
    }
  } else {
    for (const platform of videoPlatformIds) {
      videoSkippedPlatforms.push(platform);
    }
  }

  if (targets.length === 0) {
    throw new Error("publish_job has no targets (no image drafts and no stock video)");
  }

  const platforms = targets.map((t) => t.platform);
  const publishId = `${taskId}-${runId}`;

  const headless = resolvePublishHeadless({
    ...(params.headless !== undefined ? { cliHeadless: params.headless } : {}),
    configHeadless: orch.step7.headless,
    envHeadless: process.env.PUBLISH_ORCH_STEP7_HEADLESS ?? process.env.PUBLISH_HEADLESS,
  });
  const xhsDryRun =
    orch.step7.xhs_dry_run ||
    (() => {
      const raw = process.env.PUBLISH_ORCH_STEP7_XHS_DRY_RUN?.trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    })();

  const job: JobJson = {
    task_id: taskId,
    publish_id: publishId,
    targets,
    payloads,
    images: imagePaths,
    ...(videoPick ? { video: path.resolve(videoPick.path) } : {}),
    options: {
      headless,
      timeout_ms: orch.step7.timeout_ms,
      require_post_url: orch.step7.validation.require_post_url,
      after_publish_click_ms: orch.step7.human_delay.after_publish_click_ms,
      validation_mode: orch.step7.validation.mode,
      ...(xhsDryRun ? { xhs_dry_run: true } : {}),
    },
  };

  fs.mkdirSync(publishDir, { recursive: true });
  const datePart = yyyymmddJst();
  const jobPath = path.resolve(publishDir, `publish_job_${datePart}_${runId}.json`);
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), "utf-8");
  writeVideoPickArtifact(publishDir, taskId, runId, videoPick);

  return {
    jobPath,
    job,
    publishId,
    topicId,
    imagePaths,
    platforms,
    videoSkippedPlatforms,
    videoPick,
  };
}
