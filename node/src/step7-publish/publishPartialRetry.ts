import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { isPlatformId, PLATFORM_IDS, type PlatformId } from "../shared/types.js";
import type { PublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import {
  parsePlatformRowsFromTask,
  rowIsHardFailure,
  type PlatformResultRow,
} from "./publishVerification.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepField(task: JsonObject, stepName: string, field: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const v = step[field];
  return typeof v === "string" ? v : "";
}

function readRetryCounts(task: JsonObject): Record<string, number> {
  const steps = task.steps;
  if (!isObject(steps)) return {};
  const publish = steps.publish;
  if (!isObject(publish)) return {};
  const raw = publish.partial_retry_counts;
  if (!isObject(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function loadPlatformRowsForTask(task: JsonObject): PlatformResultRow[] {
  const outputRef = stepField(task, "publish", "output_ref");
  const fromFile = outputRef && fs.existsSync(outputRef) ? parsePlatformRowsFromTask(task, outputRef) : [];
  if (fromFile.length > 0) return fromFile;
  return parsePlatformRowsFromTask(task);
}

export function platformRowNeedsRetry(row: PlatformResultRow): boolean {
  return rowIsHardFailure(row);
}

export function platformsNeedingRetry(
  task: JsonObject,
  config: PublishOrchestratorConfig,
): PlatformId[] {
  if (!config.step7.partial_retry.enabled || !config.step7.retry_step7_enabled) return [];

  const rows = loadPlatformRowsForTask(task);
  if (rows.length === 0) {
    return config.platforms.publish_enabled.filter((p): p is PlatformId => isPlatformId(p));
  }

  const counts = readRetryCounts(task);
  const max = config.step7.partial_retry.max_attempts_per_platform;
  const out: PlatformId[] = [];

  for (const row of rows) {
    const platform = typeof row.platform === "string" ? row.platform : "";
    if (!isPlatformId(platform)) continue;
    if (!platformRowNeedsRetry(row)) continue;
    const used = counts[platform] ?? 0;
    if (used >= max) continue;
    out.push(platform);
  }
  return out;
}

export function resolveStep7PlatformFilter(params: {
  task: JsonObject;
  config: PublishOrchestratorConfig;
  cliFilter?: PlatformId[];
  taskStatus: string;
}): PlatformId[] | undefined {
  if (params.cliFilter && params.cliFilter.length > 0) return params.cliFilter;

  const partialStatuses = new Set(["publish_partial_failed", "published", "failed"]);
  if (!partialStatuses.has(params.taskStatus)) return undefined;

  const needs = platformsNeedingRetry(params.task, params.config);
  return needs.length > 0 ? needs : undefined;
}

export function mergePlatformResultRows(
  previous: PlatformResultRow[],
  fresh: PlatformResultRow[],
  ranPlatforms: PlatformId[],
): PlatformResultRow[] {
  const ran = new Set(ranPlatforms);
  const freshByPlatform = new Map(fresh.map((r) => [String(r.platform), r]));
  const prevByPlatform = new Map(previous.map((r) => [String(r.platform), r]));
  const order: string[] = [];
  for (const r of previous) {
    const p = String(r.platform);
    if (!order.includes(p)) order.push(p);
  }
  for (const r of fresh) {
    const p = String(r.platform);
    if (!order.includes(p)) order.push(p);
  }
  for (const p of PLATFORM_IDS) {
    if (!order.includes(p) && (freshByPlatform.has(p) || prevByPlatform.has(p))) order.push(p);
  }

  const merged: PlatformResultRow[] = [];
  for (const p of order) {
    if (ran.has(p as PlatformId) && freshByPlatform.has(p)) {
      merged.push(freshByPlatform.get(p)!);
    } else if (prevByPlatform.has(p)) {
      merged.push(prevByPlatform.get(p)!);
    } else if (freshByPlatform.has(p)) {
      merged.push(freshByPlatform.get(p)!);
    }
  }
  return merged;
}

export function bumpPartialRetryCounts(
  task: JsonObject,
  ranPlatforms: PlatformId[],
): Record<string, number> {
  const prev = readRetryCounts(task);
  const next = { ...prev };
  for (const p of ranPlatforms) {
    next[p] = (next[p] ?? 0) + 1;
  }
  return next;
}
