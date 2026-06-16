import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";

const LOCALE_DISPLAY: Record<string, string> = {
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  "en-US": "English",
  "en-GB": "English (UK)",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
};

export function localeDisplayName(locale: string): string {
  const key = locale.trim();
  return LOCALE_DISPLAY[key] ?? key;
}

export function isChineseLocale(locale: string): boolean {
  return locale.trim().toLowerCase().startsWith("zh");
}

export function getConfiguredCopyLocale(platformId: string): string {
  const cfg = loadPublishOrchestratorConfig();
  const def = cfg.platforms.definitions[platformId];
  return def?.copy.locale?.trim() || "zh-CN";
}

export function draftLanguageInstructionLine(
  platformId: string,
  locale: string,
  limits: { titleMax?: number; bodyMax: number },
): string {
  const lang = localeDisplayName(locale);
  const titlePart = limits.titleMax !== undefined ? `title ≤${limits.titleMax}, ` : "";
  return `${platformId}: title/body in ${lang} (${locale}); ${titlePart}body ≤${limits.bodyMax}`;
}

export function tagsInstructionForLocale(locale: string): string {
  if (isChineseLocale(locale)) {
    return "tags[]: short Chinese topic names without #; do NOT count toward body limit.";
  }
  if (locale.toLowerCase().startsWith("ja")) {
    return "tags[]: short Japanese labels without # when used; hashtags may go in body.";
  }
  return "tags[]: short labels in the same language as body without #, or leave empty and put hashtags in body.";
}

export function buildPerPlatformCopyLocaleLines(platformIds: string[]): string[] {
  const limitsMap = loadPublishOrchestratorConfig();
  return platformIds.map((id) => {
    const def = limitsMap.platforms.definitions[id];
    const locale = def?.copy.locale ?? "zh-CN";
    const bodyMax = def?.copy.body_max ?? 10_000;
    const titleMax = def?.copy.title_max;
    return draftLanguageInstructionLine(id, locale, {
      bodyMax,
      ...(titleMax !== undefined ? { titleMax } : {}),
    });
  });
}
