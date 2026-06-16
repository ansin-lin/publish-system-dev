import { XMLParser } from "fast-xml-parser";

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value && typeof value === "object") {
    const node = value as XmlNode;
    for (const key of ["#text", "text", "_text"]) {
      const found = node[key];
      if (typeof found === "string" || typeof found === "number") return String(found).trim();
    }
  }
  return "";
}

function linkValue(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = linkValue(item);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const node = value as XmlNode;
    const href = node["@_href"];
    if (typeof href === "string" && href.trim()) return href.trim();
    return textValue(value);
  }
  return "";
}

export function parseFeedItems(xml: string): Array<{ title: string; link: string }> {
  const parsed = parser.parse(xml) as unknown;
  const root = parsed && typeof parsed === "object" ? (parsed as XmlNode) : {};
  const rss = root.rss && typeof root.rss === "object" ? (root.rss as XmlNode) : undefined;
  const channel = rss?.channel && typeof rss.channel === "object" ? (rss.channel as XmlNode) : undefined;
  const feed = root.feed && typeof root.feed === "object" ? (root.feed as XmlNode) : undefined;
  const candidates = [...asArray(channel?.item), ...asArray(feed?.entry)];

  return candidates
    .filter((x): x is XmlNode => Boolean(x) && typeof x === "object" && !Array.isArray(x))
    .map((item) => ({
      title: textValue(item.title),
      link: linkValue(item.link),
    }))
    .filter((item) => item.title || item.link);
}

export function parseGoogleTrendsItems(xml: string): Array<{ title: string; traffic: number; link?: string }> {
  const parsed = parser.parse(xml) as unknown;
  const root = parsed && typeof parsed === "object" ? (parsed as XmlNode) : {};
  const rss = root.rss && typeof root.rss === "object" ? (root.rss as XmlNode) : undefined;
  const channel = rss?.channel && typeof rss.channel === "object" ? (rss.channel as XmlNode) : undefined;
  return asArray(channel?.item)
    .filter((x): x is XmlNode => Boolean(x) && typeof x === "object" && !Array.isArray(x))
    .map((item) => {
      const rawTraffic = textValue(item.approx_traffic).replace(/,/g, "");
      const match = rawTraffic.match(/([\d.]+)\s*\+?/);
      const traffic = match ? Number.parseFloat(match[1] ?? "0") : 0;
      const link = linkValue(item.link);
      return {
        title: textValue(item.title),
        traffic: Number.isFinite(traffic) ? traffic : 0,
        ...(link ? { link } : {}),
      };
    })
    .filter((item) => item.title);
}
