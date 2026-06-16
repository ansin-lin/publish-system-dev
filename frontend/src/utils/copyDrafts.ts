export type CopyDraftRow = {
  platform?: string;
  title?: string;
  body?: string;
  body_preview?: string;
  locale?: string;
  topic_title?: string;
};

export function draftBody(draft: CopyDraftRow): string {
  if (typeof draft.body === "string" && draft.body.trim()) return draft.body;
  if (typeof draft.body_preview === "string") return draft.body_preview;
  return "";
}

export function groupDraftsByPlatform(drafts: CopyDraftRow[]): Map<string, CopyDraftRow[]> {
  const map = new Map<string, CopyDraftRow[]>();
  for (const draft of drafts) {
    const platform = draft.platform?.trim() || "unknown";
    const list = map.get(platform) ?? [];
    list.push(draft);
    map.set(platform, list);
  }
  return map;
}
