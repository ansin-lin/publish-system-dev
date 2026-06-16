import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import type { CopyDraft } from "../step6-generate/copyRoleDispatch.js";
import { nowIsoJst } from "../orchestrator/time.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePlatform(raw: string): string {
  return raw.trim().toLowerCase();
}

export function loadCopyResultFile(copyPath: string): JsonObject {
  const raw = JSON.parse(fs.readFileSync(copyPath, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error(`copy_result must be object: ${copyPath}`);
  return raw;
}

/**
 * Merge regenerated platform drafts into existing copy_result (in-place file write).
 * Unlisted platforms keep their existing drafts; image_prompts unchanged.
 */
export function mergeCopyResultDrafts(params: {
  copyPath: string;
  newDrafts: CopyDraft[];
  operator: string;
}): { copyPath: string; mergedPlatforms: string[] } {
  const doc = loadCopyResultFile(params.copyPath);
  const itemsRaw = doc.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    throw new Error("copy_result.items is empty");
  }

  const patchByPlatform = new Map<string, CopyDraft>();
  for (const d of params.newDrafts) {
    patchByPlatform.set(normalizePlatform(d.platform), d);
  }
  if (!patchByPlatform.size) throw new Error("newDrafts is empty");

  const mergedPlatforms: string[] = [];

  for (const item of itemsRaw) {
    if (!isObject(item)) continue;
    const draftsRaw = item.drafts;
    if (!Array.isArray(draftsRaw)) continue;

    const kept: JsonObject[] = [];
    const seen = new Set<string>();

    for (const row of draftsRaw) {
      if (!isObject(row)) continue;
      const platform = typeof row.platform === "string" ? normalizePlatform(row.platform) : "";
      if (!platform) continue;
      if (patchByPlatform.has(platform)) {
        seen.add(platform);
        continue;
      }
      kept.push(row);
    }

    for (const [platform, draft] of patchByPlatform) {
      kept.push({
        platform: draft.platform,
        locale: draft.locale,
        title: draft.title,
        body: draft.body,
        tags: draft.tags,
      });
      mergedPlatforms.push(platform);
      seen.add(platform);
    }

    item.drafts = kept;
  }

  doc.generated_at = nowIsoJst();
  doc.last_merged_at = nowIsoJst();
  doc.last_merged_by = params.operator;

  fs.writeFileSync(params.copyPath, JSON.stringify(doc, null, 2), "utf-8");

  return { copyPath: params.copyPath, mergedPlatforms: [...new Set(mergedPlatforms)] };
}
