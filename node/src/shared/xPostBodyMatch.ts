/** Normalize text for loose comparison on X timeline cards (often truncated). */
export function normalizePostText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .trim()
    .toLowerCase();
}

/**
 * Whether timeline text likely reflects the post we just published.
 * - strict: full body must appear as substring
 * - balanced: first 48 chars OR ≥35% token overlap (min 4 tokens)
 * - loose: not used at publish layer (post_id alone is enough)
 */
export function xBodyMatchesTimeline(
  expectedBody: string,
  timelineText: string,
  mode: "strict" | "balanced" | "loose",
): boolean {
  const expected = normalizePostText(expectedBody);
  const shown = normalizePostText(timelineText);
  if (!expected || !shown) return false;

  if (mode === "strict") {
    return shown.includes(expected);
  }

  const prefixLen = 48;
  const prefix = expected.slice(0, prefixLen);
  if (prefix.length >= 12 && shown.includes(prefix)) return true;

  const tokens = expected.split(" ").filter((t) => t.length >= 2);
  if (tokens.length < 4) {
    return shown.includes(expected.slice(0, Math.min(24, expected.length)));
  }
  const hit = tokens.filter((t) => shown.includes(t)).length;
  return hit / tokens.length >= 0.35;
}
