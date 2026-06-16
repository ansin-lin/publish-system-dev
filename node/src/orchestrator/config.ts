import path from "node:path";
import { getWorkspaceDir } from "../shared/config.js";
import { loadPublishOrchestratorConfig } from "./publishOrchestratorConfig.js";
import type { OrchestratorSettings } from "./types.js";

export function loadOrchestratorSettings(): OrchestratorSettings {
  const publishConfig = loadPublishOrchestratorConfig();
  const workspaceDir = path.resolve(publishConfig.paths.node_dir);
  return {
    workspaceDir,
    repoRoot: publishConfig.repoRoot,
    dataDir: publishConfig.paths.data_dir,
    tasksDir: publishConfig.paths.tasks_dir,
    logsDir: publishConfig.paths.logs_dir,
    dbPath: publishConfig.paths.db_path,
    publishConfig,
  };
}

/** Repo root derived from node workspace (same as publish config loader). */
export function resolvePublishRepoRoot(): string {
  return path.resolve(getWorkspaceDir(), "..");
}
