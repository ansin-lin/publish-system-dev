import fs from "node:fs";
import path from "node:path";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { getStep6ImageSlotCount } from "./constants.js";
import { yyyymmddJst } from "../orchestrator/time.js";

export type StockImageSource = "stock_today" | "stock_common";

export type StockImagePickResult = {
  source: StockImageSource;
  paths: string[];
  poolDir: string;
};

function stockExtensions(): Set<string> {
  const cfg = loadPublishOrchestratorConfig();
  const exts = cfg.step6.image.stock.extensions.map((e) => e.toLowerCase());
  return new Set(exts.length ? exts : [".png", ".jpg", ".jpeg"]);
}

function isImageFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return stockExtensions().has(ext);
}

/** List image files in a directory (non-recursive), sorted for stable listing before shuffle. */
export function listImagesInDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  const names = fs.readdirSync(dirPath).filter((name) => {
    if (name.startsWith(".")) return false;
    const full = path.join(dirPath, name);
    try {
      return fs.statSync(full).isFile() && isImageFile(name);
    } catch {
      return false;
    }
  });
  names.sort((a, b) => a.localeCompare(b, "en"));
  return names.map((name) => path.resolve(dirPath, name));
}

export function resolveAssetsImgDir(repoRoot?: string): string {
  const cfg = loadPublishOrchestratorConfig();
  if (repoRoot) {
    const rel = cfg.paths.assets_img_dir;
    return path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(repoRoot, rel);
  }
  return cfg.paths.assets_img_dir;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic shuffle; same seed → same order (for task retry). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return [...items];
  const out = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickFromDir(params: {
  dirPath: string;
  source: StockImageSource;
  maxCount: number;
  seed: string;
}): StockImagePickResult | null {
  const all = listImagesInDir(params.dirPath);
  if (all.length === 0) return null;
  const shuffled = seededShuffle(all, params.seed);
  const paths = shuffled.slice(0, Math.min(params.maxCount, shuffled.length));
  return { source: params.source, paths, poolDir: params.dirPath };
}

/**
 * Priority from config (default: today → common → null for AI).
 * Same task_id + run_id always picks the same files when the pool is unchanged.
 */
export function pickStockImages(params: {
  taskId: string;
  runId: string;
  dateYyyymmdd?: string;
  maxCount?: number;
  assetsImgDir?: string;
  repoRoot?: string;
}): StockImagePickResult | null {
  const cfg = loadPublishOrchestratorConfig();
  const stock = cfg.step6.image.stock;
  if (!stock.enabled || stock.force_ai) return null;

  const assetsRoot = params.assetsImgDir ?? resolveAssetsImgDir(params.repoRoot);
  const dateFolder = params.dateYyyymmdd ?? yyyymmddJst();
  const maxCount = params.maxCount ?? stock.max_pick ?? getStep6ImageSlotCount();
  const seed = `${params.taskId}|${params.runId}|stock`;
  const commonName = stock.common_dir_name || "Common";

  for (const tier of stock.priority) {
    if (tier === "ai") return null;
    if (tier === "today") {
      const todayDir = path.resolve(assetsRoot, dateFolder);
      const todayPick = pickFromDir({
        dirPath: todayDir,
        source: "stock_today",
        maxCount,
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
        maxCount,
        seed: `${seed}|common`,
      });
      if (commonPick) return commonPick;
    }
  }
  return null;
}

export function hasStockImagesAvailable(params?: {
  dateYyyymmdd?: string;
  assetsImgDir?: string;
  repoRoot?: string;
}): boolean {
  const cfg = loadPublishOrchestratorConfig();
  if (!cfg.step6.image.stock.enabled) return false;
  const assetsRoot = params?.assetsImgDir ?? resolveAssetsImgDir(params?.repoRoot);
  const dateFolder = params?.dateYyyymmdd ?? yyyymmddJst();
  const commonName = cfg.step6.image.stock.common_dir_name || "Common";
  if (listImagesInDir(path.resolve(assetsRoot, dateFolder)).length > 0) return true;
  if (listImagesInDir(path.resolve(assetsRoot, commonName)).length > 0) return true;
  return false;
}
