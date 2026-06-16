import fs from "node:fs";
import path from "node:path";
import type { PublishResult } from "./types.js";
import { nowIso } from "./time.js";

export type TaskResultFile = {
  task_id: string;
  publish_id: string;
  job_path: string;
  started_at: string;
  updated_at: string;
  results: PublishResult[];
};

export function taskResultPath(artifactsDir: string, taskId: string): string {
  return path.resolve(artifactsDir, taskId, "result.json");
}

export function upsertTaskResult(params: {
  artifactsDir: string;
  jobPath: string;
  result: PublishResult;
}): TaskResultFile {
  const { artifactsDir, jobPath, result } = params;
  const p = taskResultPath(artifactsDir, result.task_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const now = nowIso();
  let existing: TaskResultFile | null = null;
  if (fs.existsSync(p)) {
    try {
      existing = JSON.parse(fs.readFileSync(p, "utf-8")) as TaskResultFile;
    } catch {
      existing = null;
    }
  }

  const base: TaskResultFile = existing && existing.task_id === result.task_id ?
    existing
    : {
        task_id: result.task_id,
        publish_id: result.publish_id,
        job_path: jobPath,
        started_at: now,
        updated_at: now,
        results: [],
      };

  // 替换同一 platform+profile 的旧结果
  const others = base.results.filter((r) => !(r.platform === result.platform && r.profile === result.profile));
  const next: TaskResultFile = {
    ...base,
    publish_id: result.publish_id,
    job_path: jobPath,
    updated_at: now,
    results: [...others, result],
  };

  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

