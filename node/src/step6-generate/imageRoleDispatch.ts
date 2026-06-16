import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "../step2-collect/types.js";
import { loadOpenClawGatewayConfig } from "../shared/analyze/config.js";
import { WebSocketOpenClawSessionsClient } from "../shared/analyze/sessionsClient.js";
import { extractJsonText } from "../step4-approval/json.js";
import type { MergedImageSlot } from "./mergeImagePrompts.js";
import {
  assertGeneratedImageFiles,
  intEnv,
  resolveImageGenerationModel,
  type GeneratedImageRecord,
} from "./imageRecords.js";

export type { GeneratedImageRecord } from "./imageRecords.js";
export { resolveImageGenerationModel } from "./imageRecords.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildImageMessage(input: {
  task_id: string;
  run_id: string;
  topic_id: string;
  title: string;
  output_dir: string;
  slots: MergedImageSlot[];
  image_generation_model: string;
}): string {
  return JSON.stringify(
    {
      role: "content-image",
      task: "generate_promo_images",
      instruction: [
        "You are content-image. For EACH slot you MUST call OpenClaw tool image_generate (action=generate) — do not skip.",
        `image_generate model (fixed): ${input.image_generation_model}`,
        "Chat/reasoning uses google/gemini-2.5-flash; image_generate uses the model above (NOT gemini-2.5-flash-image).",
        "Per slot: merge merged_prompt + research_image_hint + copy_image_prompt into one prompt.",
        "image_generate params: action=generate, outputFormat=png, count=1, aspectRatio from slot (default 16:9).",
        "If image_generate returns async task id, poll with action=status until done.",
        `Save each PNG under output_dir: ${input.output_dir}`,
        `File naming: ${input.topic_id}_<slot_id>.png (sanitize filename).`,
        "asset_path MUST be absolute path; verify file exists before status=success.",
        "Do NOT use prompt_only unless image_generate is missing from your tool list.",
        "On failure use status=failed and error message; do not fake success.",
        "Reply with JSON ONLY: { images: [{ slot_id, prompt, asset_path, status, mode, style?, aspect_ratio?, error? }] }.",
        "Follow workspace-content-image/AGENTS.md and TOOLS.md.",
      ].join(" "),
      task_id: input.task_id,
      run_id: input.run_id,
      topic_id: input.topic_id,
      title: input.title,
      output_dir: input.output_dir,
      image_generation_model: input.image_generation_model,
      slots: input.slots.map((s) => ({
        slot_id: s.slot_id,
        merged_prompt: s.merged_prompt,
        research_image_hint: s.research_image_hint,
        copy_image_prompt: s.copy_image_prompt,
        style: s.style,
        aspect_ratio: s.aspect_ratio,
      })),
    },
    null,
    2,
  );
}

export function parseImageRolePayload(parsed: unknown, slots: MergedImageSlot[]): GeneratedImageRecord[] {
  if (!isObject(parsed)) throw new Error("CONTENT_IMAGE_RESPONSE_NOT_OBJECT");
  if (parsed.ok === false) {
    const err = parsed.error;
    const msg =
      isObject(err) && typeof err.message === "string" ? err.message : "content-image returned ok:false";
    throw new Error(msg);
  }

  const imagesRaw = parsed.images;
  if (!Array.isArray(imagesRaw) || imagesRaw.length === 0) {
    throw new Error("CONTENT_IMAGE_IMAGES_EMPTY");
  }

  const bySlot = new Map<string, MergedImageSlot>();
  for (const s of slots) bySlot.set(s.slot_id, s);

  const out: GeneratedImageRecord[] = [];
  for (const row of imagesRaw) {
    if (!isObject(row)) continue;
    const slot_id = typeof row.slot_id === "string" ? row.slot_id.trim() : "";
    const slot = bySlot.get(slot_id);
    if (!slot_id || !slot) continue;
    const prompt = typeof row.prompt === "string" && row.prompt.trim() ? row.prompt.trim() : slot.merged_prompt;
    const asset_path = typeof row.asset_path === "string" ? row.asset_path.trim() : "";
    const status = typeof row.status === "string" ? row.status.trim() : asset_path ? "success" : "prompt_only";
    const mode = typeof row.mode === "string" ? row.mode.trim() : "generate";
    const rec: GeneratedImageRecord = {
      slot_id,
      prompt,
      research_image_hint: slot.research_image_hint,
      copy_image_prompt: slot.copy_image_prompt,
      mode,
      asset_path,
      status,
    };
    if (typeof row.style === "string" && row.style.trim()) rec.style = row.style.trim();
    else if (slot.style) rec.style = slot.style;
    if (typeof row.aspect_ratio === "string" && row.aspect_ratio.trim()) rec.aspect_ratio = row.aspect_ratio.trim();
    else if (slot.aspect_ratio) rec.aspect_ratio = slot.aspect_ratio;
    out.push(rec);
  }

  if (!out.length) throw new Error("CONTENT_IMAGE_NO_VALID_SLOTS");
  return out;
}

export async function runContentImageRole(params: {
  task_id: string;
  run_id: string;
  topic_id: string;
  title: string;
  output_dir: string;
  slots: MergedImageSlot[];
}): Promise<GeneratedImageRecord[]> {
  fs.mkdirSync(params.output_dir, { recursive: true });
  const gw = loadOpenClawGatewayConfig();
  if (!gw.sessions.apiToken || !gw.sessions.wsUrl) {
    throw new Error(
      "OpenClaw gateway not configured for content-image (set OPENCLAW_SESSIONS_API_* or openclaw.json gateway.auth.token)",
    );
  }

  const agentId = process.env.OPENCLAW_CONTENT_IMAGE_ROLE_ID?.trim() || "content-image";
  const timeoutMs = intEnv("OPENCLAW_CONTENT_IMAGE_TIMEOUT_MS", gw.gatewayTimeoutMs);
  const attemptId = `${Date.now()}`;
  const sessionKey =
    `agent:${agentId}:image:${params.task_id}:${params.run_id}:${params.topic_id}:${attemptId}`.replace(
      /[^a-zA-Z0-9:_-]/g,
      "_",
    );

  const imageGenerationModel = resolveImageGenerationModel();
  const message = buildImageMessage({ ...params, image_generation_model: imageGenerationModel });
  const client = new WebSocketOpenClawSessionsClient(gw.sessions, timeoutMs);
  try {
    const response = await client.run_agent({
      agent_id: agentId,
      message,
      timeout_ms: timeoutMs,
      idempotency_key: `step6-image-${params.task_id}-${params.run_id}-${params.topic_id}-${attemptId}`.replace(
        /[^a-zA-Z0-9_-]/g,
        "_",
      ),
      label: `Step6 image ${params.task_id}/${params.topic_id}`,
      ...(gw.sessions.sessionTarget === "isolated" ? { session_key: sessionKey } : {}),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonText(response.content)) as unknown;
    } catch {
      throw new Error("CONTENT_IMAGE_BAD_JSON: agent did not return parseable JSON");
    }
    const images = parseImageRolePayload(parsed, params.slots);
    for (const img of images) {
      if (!img.asset_path) continue;
      const abs = path.isAbsolute(img.asset_path) ? img.asset_path : path.resolve(params.output_dir, img.asset_path);
      if (fs.existsSync(abs)) {
        img.asset_path = abs;
        img.status = "success";
      }
    }
    assertGeneratedImageFiles(images, params.slots.length);
    return images;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`CONTENT_IMAGE_ROLE_FAILED: ${msg}`);
  }
}
