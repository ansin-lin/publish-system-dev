import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { HttpCollectError, isNonRetryableCollectError } from "./errors.js";
import { createTophubSource } from "./sources/tophub.js";
import { getStandaloneSource } from "./sources/standalone.js";
import { nowIsoJst, toJstIso } from "./time.js";
import type { CollectError, CollectResult, CollectRuntimeSettings, CollectSource, JsonObject, NormalizedCollectItem, Step2Config, TopicItem } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorRecord(platform: string, stage: string, error: unknown, dataSource: string): CollectError {
  let retryable = true;
  let errorCode: CollectError["error_code"] = "UNKNOWN_ERROR";
  if (error instanceof HttpCollectError) {
    errorCode = "NETWORK_ERROR";
  } else if (isNonRetryableCollectError(error)) {
    errorCode = "NOT_IMPLEMENTED";
    retryable = false;
  }
  return {
    platform,
    stage,
    error_code: errorCode,
    error_message: errorMessage(error),
    source: dataSource,
    retryable,
  };
}

async function runWithRetry<T>(fn: () => Promise<T>, cfg: Step2Config): Promise<T> {
  let lastError: unknown;
  const attempts = Math.max(1, cfg.retryMaxAttempts);
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(cfg.retryBackoffMs[Math.min(i - 1, cfg.retryBackoffMs.length - 1)] ?? 2_000);
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isNonRetryableCollectError(error)) break;
    }
  }
  throw lastError;
}

function normalizeItem(item: TopicItem): NormalizedCollectItem {
  const title = String(item.title ?? "").trim();
  const sourcePlatform = String(item.platform ?? "").trim().toLowerCase();
  const sourceUrl = String(item.url ?? "").trim();
  const collectedAtRaw = String(item.fetched_at ?? "").trim();
  const collectedAt = collectedAtRaw ? toJstIso(collectedAtRaw) : nowIsoJst();
  const topicIdSeed = `${sourcePlatform}|${sourceUrl}|${title}`;
  const out: NormalizedCollectItem = {
    topic_id: crypto.createHash("md5").update(topicIdSeed, "utf-8").digest("hex").slice(0, 16),
    title,
    source_platform: sourcePlatform,
    source_url: sourceUrl,
    collected_at: collectedAt,
    raw: { ...item } as JsonObject,
  };
  if (Object.prototype.hasOwnProperty.call(item, "score")) out.score = item.score;
  if (Object.prototype.hasOwnProperty.call(item, "rank")) out.rank = item.rank;
  return out;
}

async function runSource(
  source: CollectSource,
  platform: string,
  stage: string,
  cfg: Step2Config,
  extras: JsonObject | undefined,
): Promise<{ items: NormalizedCollectItem[]; error?: CollectError; stats: { ok: boolean; count: number; source: string; duration_ms: number } }> {
  const start = performance.now();
  try {
    const batch = await runWithRetry(
      async () =>
        await source.fetch({
          platform,
          limit: cfg.limit,
          query: cfg.query,
          ...(extras !== undefined ? { extras } : {}),
        }),
      cfg,
    );
    return {
      items: batch.map(normalizeItem),
      stats: {
        ok: true,
        count: batch.length,
        source: source.dataSource,
        duration_ms: Math.trunc(performance.now() - start),
      },
    };
  } catch (error) {
    return {
      items: [],
      error: errorRecord(platform, stage, error, source.dataSource),
      stats: {
        ok: false,
        count: 0,
        source: source.dataSource,
        duration_ms: Math.trunc(performance.now() - start),
      },
    };
  }
}

export async function runStep2Collect(params: {
  taskId: string;
  runId: string;
  cfg: Step2Config;
  settings: CollectRuntimeSettings;
}): Promise<CollectResult> {
  const startedAt = nowIsoJst();
  const items: NormalizedCollectItem[] = [];
  const errors: CollectError[] = [];
  const platformStats: CollectResult["meta"]["platform_stats"] = {};

  for (const platform of params.cfg.enabledPlatforms) {
    const p = platform.trim().toLowerCase();
    if (!p) continue;
    const source = createTophubSource(params.settings, p);
    const outcome = await runSource(source, p, "collect", params.cfg, undefined);
    items.push(...outcome.items);
    if (outcome.error) errors.push(outcome.error);
    platformStats[p] = outcome.stats;
  }

  for (const sourceId of params.cfg.enabledSources) {
    const s = sourceId.trim().toLowerCase();
    if (!s) continue;
    let source: CollectSource;
    try {
      source = getStandaloneSource(s);
    } catch (error) {
      errors.push(errorRecord(s, "collect_standalone", error, "standalone"));
      platformStats[s] = { ok: false, count: 0, source: "standalone", duration_ms: 0 };
      continue;
    }
    const outcome = await runSource(source, s, "collect_standalone", params.cfg, params.cfg.standaloneExtrasBySource[s]);
    items.push(...outcome.items);
    if (outcome.error) errors.push(outcome.error);
    platformStats[s] = outcome.stats;
  }

  const finishedAt = nowIsoJst();
  return {
    schema_version: "collect_result.v1",
    generated_at: finishedAt,
    task_id: params.taskId,
    run_id: params.runId,
    ok: items.length > 0,
    items,
    meta: {
      started_at: startedAt,
      finished_at: finishedAt,
      platform_stats: platformStats,
      requested: {
        aggregate_platforms: [...params.cfg.enabledPlatforms],
        standalone_sources: [...params.cfg.enabledSources],
      },
      pipeline: {
        fetch_limit_per_platform_or_source: params.cfg.limit,
        min_candidates_after_clean: params.cfg.minCandidatesAfterClean,
        allow_partial_success: params.cfg.allowPartialSuccess,
      },
    },
    errors,
  };
}
