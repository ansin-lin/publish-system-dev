import { HttpCollectError, NonRetryableCollectError } from "../errors.js";
import { fetchJson, fetchText } from "../http.js";
import { nowIsoUtc, yyyyMmDdShanghai } from "../time.js";
import type { CollectRuntimeSettings, CollectorInput, CollectSource, JsonObject, TopicItem } from "../types.js";
import { loadTophubConfig } from "../config.js";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; publish-system-collect/1.0; +https://github.com/)",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  Referer: "https://tophub.today/",
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNodeId(html: string, hashId: string): string {
  const match = html.match(/window\.nodeId\s*=\s*"(\d+)"/);
  if (!match?.[1]) throw new NonRetryableCollectError(`无法从 TopHub 页面解析 nodeId（hash=${hashId}），页面结构可能已变更`);
  return match[1];
}

function normalizeScore(scoreText: unknown): number {
  if (scoreText === undefined || scoreText === null || !String(scoreText).trim()) return 0;
  const normalized = String(scoreText).trim().replace(/[,+\s]/g, "");
  const match = normalized.match(/([\d.]+)(亿|万|千)?/);
  if (!match) return 0;
  const base = Number.parseFloat(match[1] ?? "0");
  if (!Number.isFinite(base)) return 0;
  const suffix = match[2] ?? "";
  if (suffix === "亿") return Math.round(base * 100_000_000);
  if (suffix === "万") return Math.round(base * 10_000);
  if (suffix === "千") return Math.round(base * 1_000);
  return Math.round(base);
}

function channelForPlatform(config: JsonObject, platform: string): { hashId: string; boardName: string } {
  const channels = isObject(config.channels) ? config.channels : {};
  const entry = channels[platform];
  if (!isObject(entry)) throw new NonRetryableCollectError(`配置中未定义平台频道: ${platform}（请编辑 config/tophub_channels.json）`);
  const hashId = typeof entry.hash_id === "string" ? entry.hash_id.trim() : "";
  if (!hashId) throw new NonRetryableCollectError(`平台 ${platform} 的 hash_id 为空`);
  const boardName = typeof entry.board_name === "string" && entry.board_name.trim() ? entry.board_name.trim() : platform;
  return { hashId, boardName };
}

async function resolveNodeId(baseUrl: string, hashId: string): Promise<string> {
  const html = await fetchText(`${baseUrl.replace(/\/$/, "")}/n/${hashId}`, {
    headers: { ...DEFAULT_HEADERS, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  return parseNodeId(html, hashId);
}

async function postJson(baseUrl: string, apiPath: string, form: Record<string, string>): Promise<JsonObject> {
  const payload = await fetchJson(
    `${baseUrl.replace(/\/$/, "")}${apiPath}`,
    {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams(form),
      redirect: "follow",
    },
  );
  if (!isObject(payload)) throw new Error(`TopHub API 非 JSON 对象 path=${apiPath}`);
  return payload;
}

async function fetchNodeItemsByDate(baseUrl: string, nodeId: string, date: string): Promise<JsonObject[]> {
  const payload = await postJson(baseUrl, "/node-items-by-date", { p: "1", date, nodeid: nodeId });
  if (payload.error) {
    const msg = String(payload.message ?? payload.msg ?? "") || `TopHub API 返回错误 node=${nodeId}`;
    throw new Error(msg);
  }
  const data = isObject(payload.data) ? payload.data : {};
  const items = data.items;
  return Array.isArray(items) ? items.filter(isObject) : [];
}

function latestSnapshotId(snapshots: unknown): string | undefined {
  if (!isObject(snapshots)) return undefined;
  let bestTs = -1;
  let bestId: string | undefined;
  for (const value of Object.values(snapshots)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!isObject(item) || item.id === undefined) continue;
      const ts = Number(item.timestamp ?? 0);
      if (ts >= bestTs) {
        bestTs = ts;
        bestId = String(item.id);
      }
    }
  }
  return bestId;
}

async function fetchSnapshotListRaw(baseUrl: string, nodeId: string, date: string): Promise<unknown> {
  const payload = await postJson(baseUrl, "/node-snapshot-list", { nodeid: nodeId, date });
  if (payload.error) return undefined;
  const data = isObject(payload.data) ? payload.data : {};
  return data.snapshots;
}

async function fetchNodeItemsBySnapshot(baseUrl: string, nodeId: string, snapshotId: string): Promise<JsonObject[]> {
  const payload = await postJson(baseUrl, "/node-snapshot-items", { node_id: nodeId, snapshot_id: snapshotId, p: "1" });
  if (payload.error) {
    const msg = String(payload.msg ?? payload.message ?? "node-snapshot-items 失败");
    throw new Error(msg);
  }
  const data = isObject(payload.data) ? payload.data : {};
  const items = data.items;
  return Array.isArray(items) ? items.filter(isObject) : [];
}

async function fetchNodeItems(baseUrl: string, nodeId: string, date: string): Promise<{ items: JsonObject[]; fetchTag: string; snapshotId?: string }> {
  const byDate = await fetchNodeItemsByDate(baseUrl, nodeId, date);
  if (byDate.length > 0) return { items: byDate, fetchTag: "by_date" };

  const snapshots = await fetchSnapshotListRaw(baseUrl, nodeId, date);
  const sid = latestSnapshotId(snapshots);
  if (!sid) return { items: [], fetchTag: "by_date" };
  const items = await fetchNodeItemsBySnapshot(baseUrl, nodeId, sid);
  return { items, fetchTag: "snapshot", snapshotId: sid };
}

export function createTophubSource(settings: CollectRuntimeSettings, platform: string): CollectSource {
  return {
    id: platform,
    dataSource: "tophub",
    async fetch(input: CollectorInput): Promise<TopicItem[]> {
      const config = loadTophubConfig(settings);
      const { hashId, boardName } = channelForPlatform(config, platform);
      const baseUrl = typeof config.base_url === "string" && config.base_url.trim() ? config.base_url.trim().replace(/\/$/, "") : "https://tophub.today";
      const date = yyyyMmDdShanghai();
      const nodeId = await resolveNodeId(baseUrl, hashId);
      const { items, fetchTag, snapshotId } = await fetchNodeItems(baseUrl, nodeId, date);
      const now = nowIsoUtc();
      const limit = Math.max(1, input.limit);
      const fallbackUrl = `${baseUrl}/n/${hashId}`;

      return items.slice(0, limit).map((item, index) => {
        const title = String(item.title ?? "").trim() || `${boardName} #${index + 1}`;
        const extra = String(item.extra ?? "").trim();
        const url = String(item.url ?? "").trim() || fallbackUrl;
        const sidNum = item.ID;
        const sourceId = sidNum !== undefined && sidNum !== null && String(sidNum).trim() ? String(sidNum) : `${hashId}-${index + 1}`;
        const raw: JsonObject = {
          ...item,
          source: "tophub",
          channel: hashId,
          board_name: boardName,
          origin_rank: index + 1,
          origin_hot: extra || null,
          node_id: nodeId,
          date,
          tophub_fetch: fetchTag,
        };
        if (snapshotId) raw.tophub_snapshot_id = snapshotId;
        return {
          platform,
          title,
          url,
          score: normalizeScore(extra),
          rank: index + 1,
          source_id: sourceId,
          raw,
          fetched_at: now,
        };
      });
    },
  };
}

export { HttpCollectError };
