import fs from "node:fs";
import path from "node:path";
import type { JobJson, PlatformId, PlatformPayload } from "./types.js";

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 将“系统级任务 JSON”（你期望的超集结构）适配为发布器内部 JobJson。
 *
 * 适配规则（尽量不丢信息，且对 runner/平台实现保持最小侵入）：
 * - task_id: 直接使用顶层 task_id
 * - publish_id: 优先 publish.publish_id，其次顶层 publish_id
 * - targets: 优先 publish.jobs[].(platform/profile)，否则从 draft.payloads 的键推导（profile=default）
 * - payloads: 主要来自 draft.payloads；媒体来自 media.images/media.video，注入到 payloads.default（兜底）
 * - options: 来自 publish.options（映射到 runner 识别的字段）
 */
function adaptTaskJsonToJobJson(raw: Record<string, unknown>): JobJson {
  const taskId = raw.task_id;
  assertNonEmptyString(taskId, "task.task_id 必须是非空字符串");

  const publish = isRecord(raw.publish) ? raw.publish : null;
  const publishId = publish?.publish_id ?? raw.publish_id;
  assertNonEmptyString(publishId, "task.publish.publish_id（或顶层 publish_id）必须是非空字符串");

  // draft.payloads
  const draft = isRecord(raw.draft) ? raw.draft : null;
  const draftPayloads = (draft && isRecord(draft.payloads) ? (draft.payloads as Record<string, unknown>) : null) ?? null;

  // media
  const media = isRecord(raw.media) ? raw.media : null;
  const mediaImages = Array.isArray(media?.images) ? (media!.images as unknown[]) : [];
  const mediaVideo = typeof media?.video === "string" ? media.video.trim() : "";

  // targets: publish.jobs 优先
  const targets: { platform: PlatformId; profile?: string }[] = [];
  const jobs = publish && Array.isArray(publish.jobs) ? (publish.jobs as unknown[]) : [];
  for (const j of jobs) {
    if (!isRecord(j)) continue;
    const platform = j.platform;
    if (typeof platform !== "string" || !platform.trim()) continue;
    // 这里不做强校验 platform 是否在 PlatformId union 里，交给后续 isPlatformId 使用方；
    // 但为了类型安全，这里只能做一次窄化（不匹配的直接忽略）
    const p = platform.trim() as PlatformId;
    const profile = typeof j.profile === "string" && j.profile.trim() ? j.profile.trim() : undefined;
    targets.push({ platform: p, ...(profile ? { profile } : {}) });
  }

  // 如果 publish.jobs 没提供，则从 draft.payloads 的键推导（跳过 default）
  if (targets.length === 0 && draftPayloads) {
    for (const key of Object.keys(draftPayloads)) {
      if (key === "default") continue;
      targets.push({ platform: key as PlatformId, profile: "default" });
    }
  }

  if (targets.length === 0) {
    throw new Error("task.publish.jobs 为空，且无法从 draft.payloads 推导 targets");
  }

  // 构造 payloads：draft.payloads + 注入 default 的媒体
  const payloads: Partial<Record<PlatformId | "default", PlatformPayload>> = {};
  if (draftPayloads) {
    for (const [k, v] of Object.entries(draftPayloads)) {
      if (!isRecord(v)) continue;
      const content = isRecord(v.content) ? (v.content as Record<string, unknown>) : null;
      const out: PlatformPayload = {};
      if (content) {
        const body = typeof content.body === "string" ? content.body : undefined;
        const title = typeof content.title === "string" ? content.title : undefined;
        const tags = Array.isArray(content.tags) ? (content.tags as unknown[]).map((x) => String(x)) : undefined;
        out.content = {
          ...(body !== undefined ? { body } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(tags !== undefined ? { tags } : {}),
        };
      }
      // images/video 不从 draft 读取（你的结构里在 media 里），这里先不处理
      (payloads as any)[k] = out;
    }
  }

  // 注入媒体到 default 兜底（平台 payload 未显式提供 images/video 时会回落到 default）
  const defaultPayload: PlatformPayload = isRecord(payloads.default) ? (payloads.default as PlatformPayload) : {};
  const normImages = mediaImages.map((x) => String(x).trim()).filter(Boolean);
  if (normImages.length > 0) defaultPayload.images = normImages;
  if (mediaVideo) defaultPayload.video = mediaVideo;
  payloads.default = defaultPayload;

  // publish.options -> job.options（字段名对齐）
  const pubOpts = publish && isRecord(publish.options) ? (publish.options as Record<string, unknown>) : {};
  const headless = typeof pubOpts.headless === "boolean" ? pubOpts.headless : undefined;
  const slowmoMs = typeof pubOpts.slowmo_ms === "number" ? pubOpts.slowmo_ms : undefined;
  const timeoutMs = typeof pubOpts.timeout_ms === "number" ? pubOpts.timeout_ms : undefined;

  const job: JobJson = {
    task_id: String(taskId).trim(),
    publish_id: String(publishId).trim(),
    targets,
    payloads,
    options: {
      ...(headless !== undefined ? { headless } : {}),
      ...(slowmoMs !== undefined ? { slowmo_ms: slowmoMs } : {}),
      ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    },
  };

  // 兼容 runner 的旧字段路径（可选）：把 default.images/video 同步到顶层（仅作为 fallback）
  if (defaultPayload.images) job.images = defaultPayload.images;
  if (defaultPayload.video) job.video = defaultPayload.video;

  return job;
}

function looksLikeTaskJson(raw: unknown): raw is Record<string, unknown> {
  if (!isRecord(raw)) return false;
  if (typeof raw.task_id !== "string" || !raw.task_id.trim()) return false;
  // 你给的任务结构里一定有 publish 对象（并含 publish_id / jobs / options 等）
  if (isRecord(raw.publish) && typeof raw.publish.publish_id === "string") return true;
  // 或至少有 draft/media 这些分段
  if (isRecord(raw.draft) || isRecord(raw.media) || isRecord(raw.workflow)) return true;
  return false;
}

/**
 * 读取并做最小校验：job.json 必须包含 task_id/publish_id/targets。
 * 内容来源优先级（方案 C + 兼容旧版顶层字段）：
 * - payloads.<platform>
 * - payloads.default
 * - 顶层 content/images/video（旧版）
 *
 * 注意：是否发布由 runner 决定；当某平台合并后正文为空时 runner 会返回 skipped。
 * 路径解析规则：
 * - images/video 若为相对路径，则以 job.json 所在目录为基准解析。
 */
export function loadJob(jobPath: string): { job: JobJson; jobPath: string; jobDir: string } {
  const absPath = path.resolve(jobPath);
  if (!fs.existsSync(absPath)) throw new Error(`找不到 job.json：${absPath}`);
  const raw = JSON.parse(fs.readFileSync(absPath, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("job.json 必须是一个 object/dict");
  const job = looksLikeTaskJson(raw) ? adaptTaskJsonToJobJson(raw) : (raw as JobJson);

  assertNonEmptyString(job.task_id, "job.task_id 必须是非空字符串");
  assertNonEmptyString(job.publish_id, "job.publish_id 必须是非空字符串");

  if (!Array.isArray(job.targets) || job.targets.length === 0) {
    throw new Error("job.targets 必须是非空数组，例如 [{\"platform\":\"x\",\"profile\":\"default\"}]");
  }
  for (const t of job.targets) {
    assertNonEmptyString(t.platform, "job.targets[].platform 必须是非空字符串");
  }

  // 兼容校验：若没有 payloads，则顶层 content.body 必须存在
  if (job.payloads === undefined) {
    if (!job.content || typeof job.content !== "object") throw new Error("job.content 必须是 object/dict（或使用 job.payloads）");
    assertNonEmptyString(job.content.body, "job.content.body 必须是非空字符串（或使用 job.payloads）");
  }

  return { job, jobPath: absPath, jobDir: path.dirname(absPath) };
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x).trim()).filter(Boolean);
}

function pickString(primary: unknown, fallback: unknown): string {
  const a = typeof primary === "string" ? primary.trim() : "";
  if (a) return a;
  const b = typeof fallback === "string" ? fallback.trim() : "";
  return b;
}

function pickImages(primary: PlatformPayload | undefined, fallback: PlatformPayload | undefined, legacy: string[] | undefined): string[] {
  if (primary && primary.images !== undefined) return Array.isArray(primary.images) ? primary.images : [];
  if (fallback && fallback.images !== undefined) return Array.isArray(fallback.images) ? fallback.images : [];
  return Array.isArray(legacy) ? legacy : [];
}

function pickVideo(primary: PlatformPayload | undefined, fallback: PlatformPayload | undefined, legacy: string | undefined): string | undefined {
  const v1 = primary?.video;
  if (typeof v1 === "string" && v1.trim()) return v1.trim();
  if (primary && primary.video !== undefined) return undefined; // 显式覆盖为空
  const v2 = fallback?.video;
  if (typeof v2 === "string" && v2.trim()) return v2.trim();
  if (fallback && fallback.video !== undefined) return undefined;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return undefined;
}

export type MergedPlatformPayload = {
  content: { body: string; title: string; tags: string[] };
  images: string[];
  video?: string;
};

/** 计算某平台最终使用的 payload（platform > default > legacy top-level） */
export function getPlatformPayload(job: JobJson, platform: PlatformId): MergedPlatformPayload {
  const payloads = job.payloads;
  const pPlatform = (payloads?.[platform] ?? undefined) as PlatformPayload | undefined;
  const pDefault = (payloads?.default ?? undefined) as PlatformPayload | undefined;

  const legacyContent = job.content ?? {};
  const legacyBody = typeof legacyContent.body === "string" ? legacyContent.body : "";
  const legacyTitle = typeof legacyContent.title === "string" ? legacyContent.title : "";
  const legacyTags = legacyContent.tags;

  const body = pickString(pPlatform?.content?.body, pickString(pDefault?.content?.body, legacyBody));
  const title = pickString(pPlatform?.content?.title, pickString(pDefault?.content?.title, legacyTitle));
  const tags = normalizeTags(pPlatform?.content?.tags).length ?
    normalizeTags(pPlatform?.content?.tags)
    : normalizeTags(pDefault?.content?.tags).length ?
      normalizeTags(pDefault?.content?.tags)
      : normalizeTags(legacyTags);

  const images = pickImages(pPlatform, pDefault, job.images).filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  const video = pickVideo(pPlatform, pDefault, job.video);

  const out: MergedPlatformPayload = {
    content: { body, title, tags },
    images,
  };
  if (video !== undefined) out.video = video;
  return out;
}

export function resolveJobRelativePath(jobDir: string, p: string): string {
  const s = p.trim();
  if (path.isAbsolute(s)) return path.resolve(s);
  // 支持类似 Vite/前端常见别名：@/xxx -> <repoRoot>/xxx
  // 这里按约定：job.json 位于 <root>/payloads/job.json，因此 jobDir 的父目录就是 repoRoot
  if (s.startsWith("@/")) {
    const repoRoot = path.resolve(jobDir, "..");
    return path.resolve(repoRoot, s.slice(2)); // 去掉 "@/"
  }
  return path.resolve(jobDir, s);
}

/**
 * 解析图片路径（支持只写文件名/相对名）：优先以 imageRootDir 拼接；
 * 若 imageRootDir 下不存在该文件，再回落到 resolveJobRelativePath(jobDir, p)。
 */
export function resolveImagePath(jobDir: string, imageRootDir: string, p: string): string {
  const s = p.trim();
  if (path.isAbsolute(s) || s.startsWith("@/")) return resolveJobRelativePath(jobDir, s);

  const fromRoot = path.resolve(imageRootDir, s);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return resolveJobRelativePath(jobDir, s);
}
