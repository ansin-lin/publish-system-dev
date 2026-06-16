import fs from "node:fs";
import path from "node:path";
import type { JobJson, PlatformId, PostAssets, PublishMode, Settings } from "./types.js";
import { getPlatformPayload, resolveImagePath } from "./jobLoader.js";

/**
 * 从 job.json 生成**指定平台**发布需要的素材对象。
 * 内容来源：payloads.<platform> > payloads.default > 旧顶层字段（兼容）。
 *
 * - `post`：只使用 `images`（`video` 忽略）
 * - `video`：只使用 `video`（`images` 忽略），且须为**已存在的绝对路径**
 */
export function buildAssets(
  job: JobJson,
  jobDir: string,
  platform: PlatformId,
  settings: Settings,
  mode: PublishMode = "post",
): PostAssets {
  const merged = getPlatformPayload(job, platform);
  const mediaFiles: string[] = [];

  const resolveExistingImage = (p: string): string => {
    const resolved = resolveImagePath(jobDir, settings.imageRootDir, p);
    if (fs.existsSync(resolved)) return resolved;
    throw new Error(`图片文件不存在: ${resolved}`);
  };

  if (mode === "post") {
    for (const item of merged.images) {
      if (typeof item !== "string" || !item.trim()) throw new Error("job.images 里的每一项必须是非空字符串路径");
      mediaFiles.push(resolveExistingImage(item));
    }
  } else {
    const v = merged.video?.trim();
    if (!v) throw new Error("video 模式需要 job 中提供非空 video 字段（绝对路径）");
    if (!path.isAbsolute(v)) throw new Error(`video 须为绝对路径: ${v}`);
    const abs = path.resolve(v);
    if (!fs.existsSync(abs)) throw new Error(`视频文件不存在: ${abs}`);
    mediaFiles.push(abs);
  }

  return {
    baseDir: jobDir,
    caption: merged.content.body.trim(),
    mediaFiles,
    mode,
    meta: {
      source: "job_json",
      platform,
      title: merged.content.title,
      tags: merged.content.tags,
      options: job.options ?? {},
    },
  };
}
