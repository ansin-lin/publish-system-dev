import path from "node:path";
import { loadSettings } from "../../shared/config.js";
import { runFromJob, type RunFromJobOptions } from "../../shared/runner.js";
import { isPlatformId, PLATFORM_IDS, type PlatformId, type PublishMode, type PublishResult, type Settings } from "../../shared/types.js";
export { resolvePublishHeadless } from "./headless.js";

export type { PlatformId, PublishMode, PublishResult, Settings } from "../../shared/types.js";

export type PublishParams = {
  /** 指定 job/task JSON；相对路径按 node workspace 目录解析。 */
  jobPath?: string;
  settings?: Settings;
  /** 只执行这些平台（须在 job.targets 中）；不传则执行全部 targets。 */
  platformFilter?: PlatformId[];
  /** 默认 `post`；`video` 为仅发视频。 */
  publishMode?: PublishMode;
  /** true 为无头；默认有界面，便于观察浏览器操作 */
  headless?: boolean;
};

export type PublishRunResult = {
  jobPath: string;
  results: PublishResult[];
};

export function resolvePublishJobPath(settings: Settings, jobPath?: string): string {
  const raw = typeof jobPath === "string" ? jobPath.trim() : "";
  return raw ? path.resolve(settings.workspaceDir, raw) : settings.payloadJobPath;
}

export function parsePlatformFilter(value: string | undefined): PlatformId[] | undefined {
  if (!value?.trim()) return undefined;
  const parts = value
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad: string[] = [];
  const platformFilter: PlatformId[] = [];
  for (const p of parts) {
    if (isPlatformId(p)) platformFilter.push(p);
    else bad.push(p);
  }
  if (bad.length > 0) {
    throw new Error(`未知平台（有效值：${PLATFORM_IDS.join(", ")}）：${bad.join(", ")}`);
  }
  return platformFilter.length > 0 ? platformFilter : undefined;
}

export function parsePublishMode(value: string | undefined): PublishMode {
  if (!value?.trim()) return "post";
  const mode = value.trim().toLowerCase();
  if (mode === "post" || mode === "video") return mode;
  throw new Error(`无效 --mode（只支持 post 或 video）：${value}`);
}

export async function publishJob(params: PublishParams = {}): Promise<PublishRunResult> {
  const settings = params.settings ?? loadSettings();
  const jobPath = resolvePublishJobPath(settings, params.jobPath);
  const opts: RunFromJobOptions = {};
  if (params.platformFilter !== undefined && params.platformFilter.length > 0) {
    opts.platformFilter = params.platformFilter;
  }
  if (params.publishMode !== undefined) {
    opts.publishMode = params.publishMode;
  }
  if (params.headless !== undefined) {
    opts.headless = params.headless;
  }
  const results = await runFromJob(settings, jobPath, opts);
  return { jobPath, results };
}

/** Programmatic API for callers that only need platform-level results. */
export async function runPublish(params: PublishParams = {}): Promise<PublishResult[]> {
  return (await publishJob(params)).results;
}
