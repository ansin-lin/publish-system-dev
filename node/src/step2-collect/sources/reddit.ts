import crypto from "node:crypto";
import { fetchText } from "../http.js";
import { nowIsoUtc } from "../time.js";
import type { CollectSource, CollectorInput, JsonObject, TopicItem } from "../types.js";
import { parseFeedItems } from "./rss.js";

const REDDIT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SORT_TO_PATH = new Set(["hot", "new", "rising", "top"]);

export function createRedditSource(): CollectSource {
  return {
    id: "reddit",
    dataSource: "reddit_rss",
    async fetch(input: CollectorInput): Promise<TopicItem[]> {
      const extras = input.extras ?? {};
      const subreddit = String(extras.subreddit ?? "all").trim().replace(/^\/+|\/+$/g, "") || "all";
      const rawSort = String(extras.sort ?? "hot").trim().toLowerCase();
      const sort = SORT_TO_PATH.has(rawSort) ? rawSort : "hot";
      const limit = Math.max(1, Math.min(100, input.limit));
      const url = `https://www.reddit.com/r/${subreddit}/${sort}.rss`;
      const query = new URLSearchParams({ limit: String(limit) });
      const feedUrl = `${url}?${query.toString()}`;
      const xml = await fetchText(
        feedUrl,
        {
          headers: {
            "User-Agent": REDDIT_UA,
            Accept: "application/rss+xml, application/xml, */*",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://www.reddit.com/",
          },
          redirect: "follow",
        },
        35_000,
      );
      const parsed = parseFeedItems(xml);
      const now = nowIsoUtc();
      return parsed.slice(0, limit).map((item, index) => {
        const rank = index + 1;
        const title = item.title.trim() || `reddit #${rank}`;
        const link = item.link.trim();
        const sourceId = crypto.createHash("sha256").update(link || title, "utf-8").digest("hex").slice(0, 16);
        const raw: JsonObject = {
          source: "reddit_rss",
          subreddit,
          sort,
          feed_url: feedUrl,
          origin_rank: rank,
        };
        return {
          platform: "reddit",
          title,
          url: link,
          score: Math.max(1, 1000 - index * 10),
          rank,
          source_id: sourceId,
          raw,
          fetched_at: now,
        };
      });
    },
  };
}
