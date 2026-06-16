import fs from "node:fs";
import path from "node:path";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";

export type GeneratedImageRecord = {
  slot_id: string;
  prompt: string;
  research_image_hint: string;
  copy_image_prompt: string;
  mode: string;
  style?: string;
  aspect_ratio?: string;
  asset_path: string;
  status: string;
};

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return defaultValue;
}

/** Gemini / Imagen model id for @google/genai (no `google/` prefix). */
export function resolveStep6ImageModel(): string {
  const raw =
    process.env.PUBLISH_ORCH_IMAGE_MODEL?.trim() ||
    process.env.PUBLISH_ORCH_IMAGE_GENERATION_MODEL?.trim() ||
    loadPublishOrchestratorConfig().step6.image.model;
  return raw.replace(/^google\//, "");
}

/** OpenClaw image_generate model ref (role delivery only). */
export function resolveImageGenerationModel(): string {
  return (
    process.env.PUBLISH_ORCH_IMAGE_GENERATION_MODEL?.trim() ||
    "google/gemini-3.1-flash-image-preview"
  );
}

export function sanitizeImageFileStem(topicId: string, slotId: string): string {
  const safeTopic = topicId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeSlot = slotId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeTopic}_${safeSlot}`;
}

export function assertGeneratedImageFiles(images: GeneratedImageRecord[], slotCount: number): void {
  if (boolEnv("PUBLISH_ORCH_STEP6_IMAGE_PROMPT_ONLY", false)) return;
  const cfg = loadPublishOrchestratorConfig();

  const onDisk = images.filter((img) => {
    if (!img.asset_path) return false;
    const abs = path.isAbsolute(img.asset_path) ? img.asset_path : path.resolve(img.asset_path);
    return fs.existsSync(abs);
  });

  if (onDisk.length === 0) {
    throw new Error(
      "CONTENT_IMAGE_NO_FILES_GENERATED: no PNG on disk. " +
        "Set GOOGLE_API_KEY (or GEMINI_API_KEY), check PUBLISH_ORCH_IMAGE_MODEL, and retry.",
    );
  }

  const requireAll = boolEnv(
    "PUBLISH_ORCH_STEP6_REQUIRE_ALL_IMAGE_SLOTS",
    cfg.step6.image.require_all_slots,
  );
  if (requireAll && onDisk.length < slotCount) {
    throw new Error(
      `CONTENT_IMAGE_INCOMPLETE: expected ${slotCount} image file(s), got ${onDisk.length} on disk`,
    );
  }
}
