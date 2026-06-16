import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import type { OrchestratorSettings, TaskJson } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function loadTaskJson(taskJsonPath: string): TaskJson {
  const raw = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as unknown;
  if (!isObject(raw)) throw new Error(`task.json must be an object: ${taskJsonPath}`);
  return raw;
}

export function saveTaskJsonAtomic(taskJsonPath: string, task: TaskJson): void {
  fs.mkdirSync(path.dirname(taskJsonPath), { recursive: true });
  const tmpPath = `${taskJsonPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(task, null, 2), "utf-8");
  fs.renameSync(tmpPath, taskJsonPath);
}

export function taskJsonPath(settings: OrchestratorSettings, taskId: string): string {
  return path.resolve(settings.tasksDir, taskId, "task.json");
}

export function ensureTaskDirectories(settings: OrchestratorSettings, taskId: string): string {
  const baseDir = path.resolve(settings.tasksDir, taskId);
  for (const child of ["collect", "tidy", "approve", "generate", "publish"]) {
    fs.mkdirSync(path.resolve(baseDir, child), { recursive: true });
  }
  return baseDir;
}

export function listTaskJsonPaths(settings: OrchestratorSettings): string[] {
  if (!fs.existsSync(settings.tasksDir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(settings.tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.resolve(settings.tasksDir, entry.name, "task.json");
    if (fs.existsSync(candidate)) out.push(candidate);
  }
  return out.sort();
}

export function getString(task: TaskJson, field: string): string {
  const value = task[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`task.${field} must be a non-empty string`);
  return value.trim();
}

export function getRevision(task: TaskJson): number {
  const value = task.revision;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function isTerminalStatus(status: string): boolean {
  return ["published", "publish_partial_failed", "failed", "cancelled", "aborted", "approval_timeout"].includes(status);
}
