import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Modality, type GenerateContentResponse } from "@google/genai";
import { getStep6ImageSlotCount } from "./constants.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import type { MergedImageSlot } from "./mergeImagePrompts.js";
import {
  assertGeneratedImageFiles,
  intEnv,
  resolveStep6ImageModel,
  sanitizeImageFileStem,
  type GeneratedImageRecord,
} from "./imageRecords.js";

function resolveApiKey(): string {
  const key = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "STEP6_IMAGE_NODE_NO_API_KEY: set GOOGLE_API_KEY or GEMINI_API_KEY for @google/genai image generation",
    );
  }
  return key;
}

function isImagenModel(model: string): boolean {
  return model.toLowerCase().startsWith("imagen-");
}

function normalizeAspectRatio(raw: string | undefined): string {
  const allowed = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"]);
  const v = raw?.trim();
  if (v && allowed.has(v)) return v;
  return "16:9";
}

function buildSlotPrompt(slot: MergedImageSlot): string {
  const parts = [slot.merged_prompt];
  if (slot.style?.trim()) parts.push(`Visual style: ${slot.style.trim()}`);
  return parts.join("\n\n");
}

function limitSlots(slots: MergedImageSlot[]): MergedImageSlot[] {
  const max = intEnv(
    "PUBLISH_ORCH_STEP6_IMAGE_MAX_SLOTS",
    loadPublishOrchestratorConfig().step6.image.max_slots || getStep6ImageSlotCount(),
  );
  const cap = max > 0 ? Math.min(max, slots.length) : slots.length;
  return slots.slice(0, cap);
}

function extractImageBuffer(response: GenerateContentResponse): Buffer {
  if (response.data) {
    return Buffer.from(response.data, "base64");
  }
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts) {
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (data) return Buffer.from(data, "base64");
    }
  }
  throw new Error("STEP6_IMAGE_NODE_NO_BYTES: generateContent returned no image inline data");
}

async function generateOneSlot(params: {
  ai: GoogleGenAI;
  model: string;
  slot: MergedImageSlot;
  topic_id: string;
  output_dir: string;
}): Promise<GeneratedImageRecord> {
  const prompt = buildSlotPrompt(params.slot);
  const aspectRatio = normalizeAspectRatio(params.slot.aspect_ratio);
  const fileName = `${sanitizeImageFileStem(params.topic_id, params.slot.slot_id)}.png`;
  const assetPath = path.resolve(params.output_dir, fileName);

  if (isImagenModel(params.model)) {
    const response = await params.ai.models.generateImages({
      model: params.model,
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio,
        outputMimeType: "image/png",
      },
    });
    const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
    if (!imageBytes) {
      const reason = response.generatedImages?.[0]?.raiFilteredReason;
      throw new Error(
        reason ?
          `STEP6_IMAGE_NODE_FILTERED: ${reason}`
        : "STEP6_IMAGE_NODE_EMPTY: generateImages returned no image",
      );
    }
    fs.writeFileSync(assetPath, Buffer.from(imageBytes, "base64"));
  } else {
    const response = await params.ai.models.generateContent({
      model: params.model,
      contents: prompt,
      config: {
        responseModalities: [Modality.IMAGE],
        imageConfig: { aspectRatio },
      },
    });
    const buf = extractImageBuffer(response);
    fs.writeFileSync(assetPath, buf);
  }

  return {
    slot_id: params.slot.slot_id,
    prompt,
    research_image_hint: params.slot.research_image_hint,
    copy_image_prompt: params.slot.copy_image_prompt,
    mode: "node_genai",
    asset_path: assetPath,
    status: "success",
    ...(params.slot.style ? { style: params.slot.style } : {}),
    aspect_ratio: aspectRatio,
  };
}

export async function runContentImageNode(params: {
  task_id: string;
  run_id: string;
  topic_id: string;
  title: string;
  output_dir: string;
  slots: MergedImageSlot[];
}): Promise<GeneratedImageRecord[]> {
  fs.mkdirSync(params.output_dir, { recursive: true });
  const model = resolveStep6ImageModel();
  const ai = new GoogleGenAI({ apiKey: resolveApiKey() });
  const slots = limitSlots(params.slots);
  const images: GeneratedImageRecord[] = [];

  for (const slot of slots) {
    try {
      images.push(
        await generateOneSlot({
          ai,
          model,
          slot,
          topic_id: params.topic_id,
          output_dir: params.output_dir,
        }),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `STEP6_IMAGE_NODE_FAILED slot=${slot.slot_id} model=${model}: ${msg}`,
      );
    }
  }

  assertGeneratedImageFiles(images, slots.length);
  return images;
}
