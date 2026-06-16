import fs from "node:fs";
import path from "node:path";
import type { PublishArtifacts, PublishResult } from "./types.js";

/**
 * 每次发布（按 task_id/platform/profile）独立一个 artifacts 目录，便于 OpenClaw 收集与回溯。
 */
export function buildArtifacts(artifactsDir: string, taskId: string, platform: string, profile: string): PublishArtifacts {
  const runDir = path.resolve(artifactsDir, taskId, platform, profile);
  const logPath = path.resolve(runDir, "run.log");
  const resultPath = path.resolve(runDir, "result.json");
  const screenshotPath = path.resolve(runDir, "screenshot.png");
  fs.mkdirSync(runDir, { recursive: true });
  return { runDir, logPath, resultPath, screenshotPath };
}

export function saveResult(resultPath: string, result: PublishResult): void {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");
}

