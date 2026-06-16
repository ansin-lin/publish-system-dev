import { fetchJson } from "../http.js";
import { nowIsoUtc } from "../time.js";
import type { CollectSource, CollectorInput, JsonObject, TopicItem } from "../types.js";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";
const ITEM_WEB = "https://news.ycombinator.com/item";
const STORY_PATHS = new Set(["topstories", "newstories", "beststories"]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createHackerNewsSource(): CollectSource {
  return {
    id: "hackernews",
    dataSource: "hackernews",
    async fetch(input: CollectorInput): Promise<TopicItem[]> {
      const extras = input.extras ?? {};
      const rawPath = String(extras.story_path ?? "topstories").trim();
      const storyPath = STORY_PATHS.has(rawPath) ? rawPath : "topstories";
      const limit = Math.max(1, Math.min(500, input.limit));
      const idsPayload = await fetchJson(`${HN_BASE}/${storyPath}.json`, { redirect: "follow" }, 25_000);
      const ids = Array.isArray(idsPayload) ? idsPayload.slice(0, limit).filter((x) => /^\d+$/.test(String(x))).map((x) => Number.parseInt(String(x), 10)) : [];
      const now = nowIsoUtc();
      const out: TopicItem[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        const hnId = ids[i]!;
        const item = await fetchJson(`${HN_BASE}/item/${hnId}.json`, { redirect: "follow" }, 25_000);
        if (!isObject(item) || item.type !== "story") continue;
        const title = String(item.title ?? "").trim() || `HN #${hnId}`;
        const extUrl = String(item.url ?? "").trim();
        const scoreValue = Number(item.score ?? 0);
        const rank = i + 1;
        const raw: JsonObject = {
          source: "hackernews",
          story_path: storyPath,
          hn_id: hnId,
          origin_rank: rank,
        };
        out.push({
          platform: "hackernews",
          title,
          url: extUrl || `${ITEM_WEB}?id=${hnId}`,
          score: Number.isFinite(scoreValue) ? scoreValue : 0,
          rank,
          source_id: String(hnId),
          raw,
          fetched_at: now,
        });
      }
      return out;
    },
  };
}
