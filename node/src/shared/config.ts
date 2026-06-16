import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Settings } from "./types.js";

/**
 * 基于当前文件位置推导 workspace 根目录。
 * 这样 OpenClaw 用 exec 调用时，只要 cwd 指向项目根目录即可稳定工作。
 */
export function getWorkspaceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/core/config.ts -> src/core -> src -> <root>
  // 注意：本仓库根目录就是包含 package.json 的目录（也就是 `publish/`）
  return path.resolve(here, "..", "..");
}

export function loadSettings(): Settings {
  const workspaceDir = getWorkspaceDir();
  const cfgPath = path.resolve(workspaceDir, "publish.config.json");
  const cfg = fs.existsSync(cfgPath) ?
    (JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Partial<Record<string, unknown>>)
    : {};

  const resolveMaybeRelative = (p: unknown, fallbackRelative: string) => {
    const raw = typeof p === "string" && p.trim() ? p.trim() : fallbackRelative;
    return path.isAbsolute(raw) ? raw : path.resolve(workspaceDir, raw);
  };

  const loginTimeoutMsRaw = cfg.login_timeout_ms;
  const loginTimeoutMs =
    typeof loginTimeoutMsRaw === "number" && Number.isFinite(loginTimeoutMsRaw) && loginTimeoutMsRaw > 0 ?
      loginTimeoutMsRaw
      : 300_000;

  const pickApprovedNextTask = (): string | null => {
    // workspaceDir = publish-system/node
    // tasks live at publish-system/data/tasks/approved
    const approvedDir = path.resolve(workspaceDir, "..", "data", "tasks", "approved");
    try {
      if (!fs.existsSync(approvedDir)) return null;
      const files = fs
        .readdirSync(approvedDir)
        .filter((f) => f.toLowerCase().endsWith(".json"))
        .map((f) => path.resolve(approvedDir, f));
      if (files.length === 0) return null;
      files.sort((a, b) => {
        const sa = fs.statSync(a);
        const sb = fs.statSync(b);
        const ta = sa.mtimeMs;
        const tb = sb.mtimeMs;
        if (ta !== tb) return ta - tb; // oldest first
        return path.basename(a).localeCompare(path.basename(b));
      });
      return files[0] ?? null;
    } catch {
      return null;
    }
  };

  const fallbackPayloadJobPath = path.resolve(workspaceDir, "payloads", "job.json");
  const defaultJobPath = pickApprovedNextTask() ?? (fs.existsSync(fallbackPayloadJobPath) ? fallbackPayloadJobPath : null);

  return {
    workspaceDir,
    payloadJobPath: defaultJobPath ?? fallbackPayloadJobPath,
    accountsDir: path.resolve(workspaceDir, "accounts"),
    storageDir: resolveMaybeRelative(cfg.storage_dir, "storage"),
    artifactsDir: resolveMaybeRelative(cfg.artifacts_dir, "artifacts"),
    chromeProfilesDir: resolveMaybeRelative(cfg.chrome_profiles_dir, ".runtime/chrome-profiles"),
    imageRootDir: resolveMaybeRelative(cfg.image_root_dir, "asserts/img"),
    loginTimeoutMs,
  };
}

