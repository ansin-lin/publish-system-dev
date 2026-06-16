import { fetchText } from "../http.js";
import { nowIsoUtc } from "../time.js";
import type { CollectSource, CollectorInput, JsonObject, TopicItem } from "../types.js";
import { parseGoogleTrendsItems } from "./rss.js";

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function createGoogleTrendsSource(): CollectSource {
  return {
    id: "google_trends",
    dataSource: "google_trends",
    async fetch(input: CollectorInput): Promise<TopicItem[]> {
      const extras = input.extras ?? {};
      let geo = String(extras.geo ?? "US").trim().toUpperCase();
      if (geo.length > 5) geo = "US";
      const limit = Math.max(1, input.limit);
      const rssUrl = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
      const xml = await fetchText(
        rssUrl,
        {
          headers: { "User-Agent": DEFAULT_UA },
          redirect: "follow",
        },
        25_000,
      );
      const rows = parseGoogleTrendsItems(xml);
      const now = nowIsoUtc();
      return rows.slice(0, limit).map((row, index) => {
        const rank = index + 1;
        const score = row.traffic > 0 ? row.traffic : Math.max(1, 1000 - index * 10);
        const query = row.title.replace(/ /g, "+");
        const raw: JsonObject = {
          source: "google_trends_rss",
          geo,
          rss_url: rssUrl,
          approx_traffic: row.traffic || null,
          origin_rank: rank,
        };
        return {
          platform: "google_trends",
          title: row.title,
          url: `https://www.google.com/search?q=${query}&ie=UTF-8`,
          score,
          rank,
          source_id: `rss:${geo}:${rank}:${row.title}`.slice(0, 128),
          raw,
          fetched_at: now,
        };
      });
    },
  };
}
