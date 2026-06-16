import fs from "node:fs";
import path from "node:path";

/**
 * Playwright storageState 文件路径：
 * storage/<platform>/<profile>/state.json
 */
export function storageStatePath(storageDir: string, platform: string, profile: string): string {
  return path.resolve(storageDir, platform, profile, "state.json");
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

