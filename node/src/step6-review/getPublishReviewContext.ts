import fs from "node:fs";
import type { JsonObject } from "../step2-collect/types.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { loadTaskJson } from "../orchestrator/taskStore.js";
import {
  canRegenerateCopy,
  copyRevisionCount,
  isPublishReviewEnabled,
} from "./copyReviewGuards.js";
import { loadCopyResultFile } from "./mergeCopyResult.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepField(task: JsonObject, stepName: string, field: string): string {
  const steps = task.steps;
  if (!isObject(steps)) return "";
  const step = steps[stepName];
  if (!isObject(step)) return "";
  const v = step[field];
  return typeof v === "string" ? v : "";
}

export type PublishReviewDraftRow = {
  platform: string;
  locale: string;
  title: string;
  body: string;
  tags: string[];
  topic_title?: string;
};

export type PublishReviewContext = {
  enabled: boolean;
  task_status: string;
  revision_count: number;
  max_revisions: number;
  can_regenerate: boolean;
  regenerate_blocked_reason?: string;
  copy_review_status: string;
  last_error?: string;
  last_error_kind?: "constraint" | "other";
  last_regenerated_platforms?: string[];
  last_regenerated_at?: string;
  drafts: PublishReviewDraftRow[];
  image_count: number;
};

export function getPublishReviewContext(taskJsonPath: string): PublishReviewContext {
  const config = loadPublishOrchestratorConfig();
  const task = loadTaskJson(taskJsonPath);
  const status = typeof task.status === "string" ? task.status : "";
  const enabled = isPublishReviewEnabled(config);
  const maxRevisions = config.step6.publish_review.max_revisions;
  const revisionCount = copyRevisionCount(task);
  const regen = canRegenerateCopy(task, config);

  const copyReviewStep = task.steps && isObject(task.steps) ? task.steps.copy_review : null;
  const copyReviewStatus =
    isObject(copyReviewStep) && typeof copyReviewStep.status === "string" ? copyReviewStep.status : "";
  const lastError =
    isObject(copyReviewStep) && typeof copyReviewStep.last_error === "string" ?
      copyReviewStep.last_error
    : undefined;
  const lastErrorKindRaw =
    isObject(copyReviewStep) && typeof copyReviewStep.last_error_kind === "string" ?
      copyReviewStep.last_error_kind
    : undefined;
  const lastErrorKind =
    lastErrorKindRaw === "constraint" || lastErrorKindRaw === "other" ? lastErrorKindRaw : undefined;

  let lastRegeneratedPlatforms: string[] = [];
  let lastRegeneratedAt: string | undefined;
  const copyStep = task.steps && isObject(task.steps) ? task.steps.copy : null;
  if (isObject(copyStep)) {
    if (typeof copyStep.last_regenerated_at === "string" && copyStep.last_regenerated_at.trim()) {
      lastRegeneratedAt = copyStep.last_regenerated_at.trim();
    }
    const revisions = copyStep.revisions;
    if (Array.isArray(revisions) && revisions.length > 0) {
      const lastRev = revisions[revisions.length - 1];
      if (isObject(lastRev) && Array.isArray(lastRev.platforms)) {
        lastRegeneratedPlatforms = lastRev.platforms.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        );
      }
    }
  }

  const drafts: PublishReviewDraftRow[] = [];
  const copyPath = stepField(task, "copy", "output_ref");
  if (copyPath && fs.existsSync(copyPath)) {
    const doc = loadCopyResultFile(copyPath);
    const items = Array.isArray(doc.items) ? doc.items : [];
    for (const item of items) {
      if (!isObject(item)) continue;
      const topicTitle = typeof item.title === "string" ? item.title : undefined;
      const itemDrafts = Array.isArray(item.drafts) ? item.drafts : [];
      for (const d of itemDrafts) {
        if (!isObject(d)) continue;
        const platform = typeof d.platform === "string" ? d.platform : "";
        const body = typeof d.body === "string" ? d.body : "";
        if (!platform || !body) continue;
        drafts.push({
          platform,
          locale: typeof d.locale === "string" ? d.locale : "",
          title: typeof d.title === "string" ? d.title : "",
          body,
          tags: Array.isArray(d.tags) ?
            d.tags.filter((t): t is string => typeof t === "string")
          : [],
          ...(topicTitle ? { topic_title: topicTitle } : {}),
        });
      }
    }
  }

  let imageCount = 0;
  const imagePath = stepField(task, "image", "output_ref");
  if (imagePath && fs.existsSync(imagePath)) {
    try {
      const imgDoc = JSON.parse(fs.readFileSync(imagePath, "utf8")) as unknown;
      if (isObject(imgDoc) && Array.isArray(imgDoc.images)) {
        imageCount = imgDoc.images.filter(
          (row) => isObject(row) && row.status === "success",
        ).length;
      }
    } catch {
      imageCount = 0;
    }
  }

  return {
    enabled,
    task_status: status,
    revision_count: revisionCount,
    max_revisions: maxRevisions,
    can_regenerate: regen.ok,
    ...(regen.reason ? { regenerate_blocked_reason: regen.reason } : {}),
    copy_review_status: copyReviewStatus,
    ...(lastError ? { last_error: lastError } : {}),
    ...(lastErrorKind ? { last_error_kind: lastErrorKind } : {}),
    ...(lastRegeneratedPlatforms.length ? { last_regenerated_platforms: lastRegeneratedPlatforms } : {}),
    ...(lastRegeneratedAt ? { last_regenerated_at: lastRegeneratedAt } : {}),
    drafts,
    image_count: imageCount,
  };
}
