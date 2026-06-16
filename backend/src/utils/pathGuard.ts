import fs from "node:fs";
import path from "node:path";

/** Resolve `relativePath` under `baseDir`; reject traversal and symlinks escaping base. */
export function resolveUnderBase(baseDir: string, relativePath: string): string | null {
  const base = path.resolve(baseDir);
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;

  const resolved = path.resolve(base, normalized);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  return resolved;
}

export function assertReadableFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
}

export function taskDir(tasksDir: string, taskId: string): string {
  return path.resolve(tasksDir, taskId);
}
