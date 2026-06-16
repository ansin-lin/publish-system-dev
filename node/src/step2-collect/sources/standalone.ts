import { CollectorNotImplementedError } from "../errors.js";
import type { CollectSource } from "../types.js";
import { createGoogleTrendsSource } from "./googleTrends.js";
import { createHackerNewsSource } from "./hackernews.js";
import { createRedditSource } from "./reddit.js";

const STANDALONE_SOURCES = ["google_trends", "hackernews", "reddit"] as const;

export function listStandaloneSources(): string[] {
  return [...STANDALONE_SOURCES].sort();
}

export function getStandaloneSource(sourceId: string): CollectSource {
  const source = sourceId.trim().toLowerCase();
  if (source === "google_trends") return createGoogleTrendsSource();
  if (source === "reddit") return createRedditSource();
  if (source === "hackernews") return createHackerNewsSource();
  throw new CollectorNotImplementedError(sourceId, listStandaloneSources());
}
