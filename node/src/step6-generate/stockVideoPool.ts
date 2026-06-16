import fs from "node:fs";
import path from "node:path";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { yyyymmddJst } from "../orchestrator/time.js";
import { seededShuffle } from "./stockImagePool.js";

export type StockVideoSource = "stock_today" | "stock_common";

export type StockVideoPickResult = {
  source: StockVideoSource;
  path: string;
  poolDir: string;
};

function stockExtensions(): Set<string> {
  const cfg = loadPublishOrchestratorConfig();
  const exts = cfg.step7.video.stock.extensions.map((e) => e.toLowerCase());
  return new Set(exts.length ? exts : [".mp4"]);
}

function isVideoFile(name: string): boolean {
  return stockExtensions().has(path.extname(name).toLowerCase());
}

/** List video files in a directory (non-recursive), sorted for stable listing before shuffle. */
export function listVideosInDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  const names = fs.readdirSync(dirPath).filter((name) => {
    if (name.startsWith(".")) return false;
    const full = path.join(dirPath, name);
    try {
      return fs.statSync(full).isFile() && isVideoFile(name);
    } catch {
      return false;
    }
  });
  names.sort((a, b) => a.localeCompare(b, "en"));
  return names.map((name) => path.resolve(dirPath, name));
}

export function resolveAssetsVideoDir(repoRoot?: string): string {
  const cfg = loadPublishOrchestratorConfig();
  if (repoRoot) {
    const rel = cfg.paths.assets_video_dir;
    return path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(repoRoot, rel);
  }
  return cfg.paths.assets_video_dir;
}

function pickFromDir(params: {
  dirPath: string;
  source: StockVideoSource;
  seed: string;
}): StockVideoPickResult | null {
  const all = listVideosInDir(params.dirPath);
  if (all.length === 0) return null;
  // 目录内多个 .mp4 时按 seed 打乱后取 1 个（与 step6.image.stock 配图逻辑一致）
  const shuffled = seededShuffle(all, params.seed);
  const picked = shuffled[0]!;
  return { source: params.source, path: picked, poolDir: params.dirPath };
}

/**
 * Priority from config (default: today → common).
 * 同一目录多个视频时只选 1 个（seed 伪随机，非固定按文件名）。
 * 相同 task_id + run_id 在素材池不变时重试会选到同一文件。
 */
export function pickStockVideo(params: {
  taskId: string;
  runId: string;
  dateYyyymmdd?: string;
  assetsVideoDir?: string;
  repoRoot?: string;
}): StockVideoPickResult | null {
  const cfg = loadPublishOrchestratorConfig();
  const stock = cfg.step7.video.stock;
  if (!stock.enabled) return null;

  const assetsRoot = params.assetsVideoDir ?? resolveAssetsVideoDir(params.repoRoot);
  const dateFolder = params.dateYyyymmdd ?? yyyymmddJst();
  const seed = `${params.taskId}|${params.runId}|stock-video`;
  const commonName = stock.common_dir_name || "Common";

  for (const tier of stock.priority) {
    if (tier === "today") {
      const todayDir = path.resolve(assetsRoot, dateFolder);
      const todayPick = pickFromDir({
        dirPath: todayDir,
        source: "stock_today",
        seed: `${seed}|today`,
      });
      if (todayPick) return todayPick;
      continue;
    }
    if (tier === "common") {
      const commonDir = path.resolve(assetsRoot, commonName);
      const commonPick = pickFromDir({
        dirPath: commonDir,
        source: "stock_common",
        seed: `${seed}|common`,
      });
      if (commonPick) return commonPick;
    }
  }
  return null;
}
