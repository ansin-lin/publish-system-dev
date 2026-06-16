import fs from "node:fs";
import path from "node:path";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import type { CollectRuntimeSettings, JsonObject, PathSettings, Step2Config } from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(filePath: string): JsonObject {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  if (!isObject(raw)) throw new Error(`${filePath} must be a JSON object`);
  return raw;
}

function resolveInputPath(repoRoot: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) return path.resolve(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(repoRoot, inputPath);
}

function pathsFromPublishConfig(): CollectRuntimeSettings {
  const cfg = loadPublishOrchestratorConfig();
  const paths: PathSettings = {
    dataDir: cfg.paths.data_dir,
    tasksDir: cfg.paths.tasks_dir,
    logsDir: cfg.paths.logs_dir,
    logsTaskDir: cfg.paths.logs_task_dir,
    logsPublishDir: cfg.paths.logs_publish_dir,
    logsJobsDir: cfg.paths.logs_jobs_dir,
    systemLog: cfg.paths.system_log,
  };
  return { workspaceDir: cfg.paths.node_dir, repoRoot: cfg.repoRoot, paths };
}

export function loadCollectSettings(): CollectRuntimeSettings {
  return pathsFromPublishConfig();
}

export function resolveCollectInputPath(settings: CollectRuntimeSettings, inputPath: string): string {
  return resolveInputPath(settings.repoRoot, inputPath);
}

export function loadAggregateConfig(settings: CollectRuntimeSettings, configPath?: string): JsonObject {
  if (configPath?.trim()) return readJsonObject(resolveInputPath(settings.repoRoot, configPath.trim()));
  const rel = loadPublishOrchestratorConfig().step2.aggregate_config_path;
  return readJsonObject(resolveInputPath(settings.repoRoot, rel));
}

export function loadStandaloneConfig(settings: CollectRuntimeSettings, configPath?: string): JsonObject {
  if (configPath?.trim()) return readJsonObject(resolveInputPath(settings.repoRoot, configPath.trim()));
  const rel = loadPublishOrchestratorConfig().step2.standalone_config_path;
  return readJsonObject(resolveInputPath(settings.repoRoot, rel));
}

export function loadTophubConfig(settings: CollectRuntimeSettings, configPath?: string): JsonObject {
  if (configPath?.trim()) return readJsonObject(resolveInputPath(settings.repoRoot, configPath.trim()));
  const rel = loadPublishOrchestratorConfig().step2.tophub_channels_path;
  return readJsonObject(resolveInputPath(settings.repoRoot, rel));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x).trim()).filter(Boolean);
}

function intValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function buildStep2Config(aggregateConfig: JsonObject, standaloneConfig: JsonObject): Step2Config {
  const limit = Math.max(1, intValue(aggregateConfig.fetch_limit_per_platform, 20));
  const sourcesRaw = isObject(standaloneConfig.sources) ? standaloneConfig.sources : {};
  const standaloneExtrasBySource: Record<string, JsonObject> = {};
  for (const [key, value] of Object.entries(sourcesRaw)) {
    if (isObject(value)) standaloneExtrasBySource[key.trim().toLowerCase()] = value;
  }
  const allowPartial = loadPublishOrchestratorConfig().step2.allow_partial_success_continue;
  return {
    enabledPlatforms: stringArray(aggregateConfig.enabled_platforms),
    enabledSources: stringArray(standaloneConfig.enabled_sources),
    limit,
    query: typeof aggregateConfig.query === "string" ? aggregateConfig.query : "",
    allowPartialSuccess: allowPartial,
    minCandidatesAfterClean: intValue(aggregateConfig.min_candidates_after_clean, 1),
    standaloneExtrasBySource,
    retryMaxAttempts: 2,
    retryBackoffMs: [2_000, 5_000],
  };
}
