import type { JsonObject } from "../step2-collect/types.js";
import { loadOpenClawGatewayConfig } from "../shared/analyze/config.js";
import { WebSocketOpenClawSessionsClient } from "../shared/analyze/sessionsClient.js";
import { extractJsonText } from "../step4-approval/json.js";
import { getStep6ImageSlotCount } from "./constants.js";
import {
  getCopyPlatformAliases,
  getCopyPlatformLimits,
  loadPublishOrchestratorConfig,
} from "../orchestrator/publishOrchestratorConfig.js";
import type { TopicResearchItem } from "./topicResearch.js";
import {
  buildPerPlatformCopyLocaleLines,
  getConfiguredCopyLocale,
  tagsInstructionForLocale,
} from "./copyLocale.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type CopyDraft = {
  platform: string;
  locale: string;
  title: string;
  body: string;
  tags: string[];
};

export type CopyImagePrompt = {
  slot_id: string;
  prompt: string;
  style?: string;
  aspect_ratio?: string;
};

export type CopyItemResult = {
  topic_id: string;
  title: string;
  writing_angle: string;
  drafts: CopyDraft[];
  image_prompts: CopyImagePrompt[];
};

/** Per-platform copy limits from publish.orchestrator.json. */
export function copyPlatformLimits(platformIds?: string[]) {
  return getCopyPlatformLimits(platformIds);
}

function textLength(text: string): number {
  return [...text].length;
}

function normalizeCopyPlatform(raw: string): string {
  const aliases = getCopyPlatformAliases();
  const key = raw.trim().toLowerCase();
  return aliases[raw.trim()] ?? aliases[key] ?? key;
}

export type DraftLimitViolation = {
  platform: string;
  label: string;
  field: "title" | "body";
  length: number;
  max: number;
};

/** Collect per-platform title/body limit violations (Unicode code-point counts). */
export function collectDraftLimitViolations(
  drafts: CopyDraft[],
  platformIds?: string[],
): DraftLimitViolation[] {
  const limitsMap = copyPlatformLimits(platformIds);
  const out: DraftLimitViolation[] = [];
  for (const d of drafts) {
    const platform = normalizeCopyPlatform(d.platform);
    const limits = limitsMap[platform];
    if (!limits) continue;
    if (limits.titleMax !== undefined) {
      const titleLen = textLength(d.title);
      if (titleLen > limits.titleMax) {
        out.push({
          platform,
          label: limits.label,
          field: "title",
          length: titleLen,
          max: limits.titleMax,
        });
      }
    }
    const bodyLen = textLength(d.body);
    if (bodyLen > limits.bodyMax) {
      out.push({
        platform,
        label: limits.label,
        field: "body",
        length: bodyLen,
        max: limits.bodyMax,
      });
    }
  }
  return out;
}

function collectMissingCopyPlatforms(drafts: CopyDraft[], requiredPlatforms: string[]): string[] {
  const limitsMap = copyPlatformLimits(requiredPlatforms);
  const required = requiredPlatforms.length ? requiredPlatforms : Object.keys(limitsMap);
  const seen = new Set<string>();
  for (const d of drafts) {
    const platform = normalizeCopyPlatform(d.platform);
    if (limitsMap[platform]) seen.add(platform);
  }
  return required.filter((p) => !seen.has(p));
}

function collectEmptyYoutubeBodyViolations(drafts: CopyDraft[], requiredPlatforms: string[]): string[] {
  if (!requiredPlatforms.includes("youtube")) return [];
  for (const d of drafts) {
    if (normalizeCopyPlatform(d.platform) === "youtube" && !d.body.trim()) {
      return ["youtube body must be non-empty (description for Studio)"];
    }
  }
  return [];
}

function formatLimitViolations(violations: DraftLimitViolation[]): string {
  return violations
    .map((v) => `${v.label} (${v.platform}) ${v.field}: ${v.length} chars, max ${v.max}`)
    .join("; ");
}

/** Truncate title/body to platform limits (last resort so the pipeline does not hard-fail). */
export function clampDraftsToLimits(drafts: CopyDraft[]): CopyDraft[] {
  const limitsMap = copyPlatformLimits();
  return drafts.map((d) => {
    const platform = normalizeCopyPlatform(d.platform);
    const limits = limitsMap[platform];
    if (!limits) return { ...d };
    const locale = d.locale?.trim() || limits.locale;
    let title = d.title;
    let body = d.body;
    if (limits.titleMax !== undefined && textLength(title) > limits.titleMax) {
      title = [...title].slice(0, limits.titleMax).join("");
    }
    if (textLength(body) > limits.bodyMax) {
      body = [...body].slice(0, limits.bodyMax).join("");
    }
    return { ...d, platform: limits ? platform : d.platform, locale, title, body };
  });
}

function validateDraftLimits(drafts: CopyDraft[], requiredPlatforms: string[]): void {
  const violations = collectDraftLimitViolations(drafts, requiredPlatforms);
  if (violations.length) {
    throw new Error(`CONTENT_COPY_DRAFT_LIMIT: ${formatLimitViolations(violations)}`);
  }
  const emptyYoutube = collectEmptyYoutubeBodyViolations(drafts, requiredPlatforms);
  if (emptyYoutube.length) {
    throw new Error(`CONTENT_COPY_DRAFT_LIMIT: ${emptyYoutube.join("; ")}`);
  }
  const missing = collectMissingCopyPlatforms(drafts, requiredPlatforms);
  if (missing.length) {
    throw new Error(
      `CONTENT_COPY_DRAFT_MISSING_PLATFORMS: need drafts for ${missing.join(", ")}`,
    );
  }
}

function isCopyDraftRetryableError(message: string): boolean {
  return (
    message.includes("CONTENT_COPY_DRAFT_LIMIT") ||
    message.includes("CONTENT_COPY_DRAFT_MISSING_PLATFORMS")
  );
}

function copyLimitRetryMaxAttempts(): number {
  const raw = process.env.PUBLISH_ORCH_COPY_LIMIT_RETRY_MAX?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 3;
}

function buildCopyMessage(input: {
  item: TopicResearchItem;
  task_id: string;
  run_id: string;
  copy_platforms: string[];
  /** Set on retry after limit / missing-platform validation failure. */
  correction?: string;
}): string {
  const { item } = input;
  const cfg = loadPublishOrchestratorConfig();
  const slotCount = getStep6ImageSlotCount();
  const aspect = cfg.step6.copy.image_prompt_aspect_ratio;
  const limitsMap = copyPlatformLimits(input.copy_platforms);
  const platformList = input.copy_platforms.join(", ");
  const localeLines = buildPerPlatformCopyLocaleLines(input.copy_platforms);
  const tagsLines = input.copy_platforms.map((id) => {
    const locale = limitsMap[id]?.locale ?? getConfiguredCopyLocale(id);
    return `${id}: ${tagsInstructionForLocale(locale)}`;
  });
  const platformNotes: string[] = [];
  if (input.copy_platforms.includes("youtube")) {
    platformNotes.push(
      "youtube: title + body required; body is the video description (non-empty); title ≤ limit.",
    );
  }
  if (input.copy_platforms.includes("tiktok")) {
    platformNotes.push(
      "tiktok: body is the video caption; put hashtags inside body (#话题); tags[] optional and not auto-appended by publisher.",
    );
  }
  return JSON.stringify(
    {
      role: "content-copy",
      task: "generate_promo_copy",
      instruction: [
        "Generate IT promotion copy and image generation prompts from the given topic_research item.",
        "Reply with JSON ONLY (no markdown fence, no prose).",
        'Root keys: "writing_angle" (string, Chinese — internal angle only), "drafts" (array), "image_prompts" (array).',
        `drafts[]: each { platform, locale, title, body, tags[] } — MUST include platforms: ${platformList}.`,
        "Set drafts[].locale to the BCP47 code shown for that platform (must match orchestrator config).",
        "Write each platform title/body in that platform language (professional IT promo tone).",
        ...localeLines,
        ...tagsLines,
        "Character limits apply to body and title fields only; tags[] do NOT count toward body limits.",
        ...platformNotes,
        `image_prompts[]: exactly ${slotCount} entries (slot_id img_1..img_${slotCount}), shared asset pack for all platforms.`,
        `Each image prompt: English-first art direction; aspect_ratio ${aspect}; style tech editorial; all prompts on-topic.`,
        "research.images[4+] are reference only; orchestrator uses first merge slots.",
        "Follow workspace-content-copy/AGENTS.md and publish-system/docs/01_detailed_design/step6_copy_image_spec.md.",
        "Do not invent verified statistics or exploit tutorials.",
        ...(input.correction ?
          [
            `CORRECTION (must fix before resubmitting): ${input.correction}`,
            "Return the full JSON again (writing_angle, drafts, image_prompts). Shorten only the fields that exceeded limits; keep meaning.",
          ]
        : []),
      ].join(" "),
      task_id: input.task_id,
      run_id: input.run_id,
      topic_id: item.topic_id,
      title: item.title,
      source_platform: item.source_platform,
      source_url: item.source_url,
      research: item.research,
    },
    null,
    2,
  );
}

export function parseCopyRolePayload(
  parsed: unknown,
  options?: { validateLimits?: boolean; copyPlatforms?: string[] },
): Omit<CopyItemResult, "topic_id" | "title"> {
  const validateLimits = options?.validateLimits !== false;
  const requiredPlatforms = options?.copyPlatforms ?? loadPublishOrchestratorConfig().platforms.copy_required;
  if (!isObject(parsed)) throw new Error("CONTENT_COPY_RESPONSE_NOT_OBJECT");
  if (parsed.ok === false) {
    const err = parsed.error;
    const msg =
      isObject(err) && typeof err.message === "string" ? err.message : "content-copy returned ok:false";
    throw new Error(msg);
  }

  const writing_angle = typeof parsed.writing_angle === "string" ? parsed.writing_angle.trim() : "";
  if (!writing_angle) throw new Error("CONTENT_COPY_MISSING_WRITING_ANGLE");

  const draftsRaw = parsed.drafts;
  if (!Array.isArray(draftsRaw) || draftsRaw.length === 0) {
    throw new Error("CONTENT_COPY_DRAFTS_EMPTY");
  }
  const drafts: CopyDraft[] = [];
  for (const d of draftsRaw) {
    if (!isObject(d)) continue;
    const platform = typeof d.platform === "string" ? d.platform.trim() : "";
    const title = typeof d.title === "string" ? d.title.trim() : "";
    const body = typeof d.body === "string" ? d.body.trim() : "";
    if (!platform || !body) continue;
    const tags = Array.isArray(d.tags) ?
      d.tags.filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
    : [];
    const normalizedPlatform = normalizeCopyPlatform(platform);
    const limits = copyPlatformLimits(requiredPlatforms)[normalizedPlatform];
    const locale =
      typeof d.locale === "string" && d.locale.trim() ?
        d.locale.trim()
      : limits?.locale ?? getConfiguredCopyLocale(normalizedPlatform);
    drafts.push({
      platform: limits ? normalizedPlatform : platform,
      locale,
      title: title || writing_angle.slice(0, limits?.titleMax ?? 80),
      body,
      tags,
    });
  }
  if (!drafts.length) throw new Error("CONTENT_COPY_DRAFTS_INVALID");
  if (validateLimits) validateDraftLimits(drafts, requiredPlatforms);

  const promptsRaw = parsed.image_prompts;
  const slotCount = getStep6ImageSlotCount();
  if (!Array.isArray(promptsRaw) || promptsRaw.length < slotCount) {
    throw new Error(
      `CONTENT_COPY_IMAGE_PROMPTS_TOO_SHORT (need exactly ${slotCount})`,
    );
  }
  const image_prompts: CopyImagePrompt[] = [];
  for (let i = 0; i < slotCount; i += 1) {
    const p = promptsRaw[i];
    if (!isObject(p)) continue;
    const prompt = typeof p.prompt === "string" ? p.prompt.trim() : "";
    if (!prompt) continue;
    const slot_id = typeof p.slot_id === "string" && p.slot_id.trim() ? p.slot_id.trim() : `img_${i + 1}`;
    const row: CopyImagePrompt = {
      slot_id,
      prompt,
      style: "tech editorial",
      aspect_ratio: "16:9",
    };
    if (typeof p.style === "string" && p.style.trim()) row.style = p.style.trim();
    if (typeof p.aspect_ratio === "string" && p.aspect_ratio.trim()) row.aspect_ratio = p.aspect_ratio.trim();
    image_prompts.push(row);
  }
  if (image_prompts.length !== slotCount) {
    throw new Error(
      `CONTENT_COPY_IMAGE_PROMPTS_COUNT: expected ${slotCount}, got ${image_prompts.length}`,
    );
  }

  return { writing_angle, drafts, image_prompts };
}

export async function runContentCopyRole(params: {
  item: TopicResearchItem;
  task_id: string;
  run_id: string;
  copy_platforms: string[];
}): Promise<CopyItemResult> {
  const gw = loadOpenClawGatewayConfig();
  if (!gw.sessions.apiToken || !gw.sessions.wsUrl) {
    throw new Error(
      "OpenClaw gateway not configured for content-copy (set OPENCLAW_SESSIONS_API_* or openclaw.json gateway.auth.token)",
    );
  }

  const agentId = process.env.OPENCLAW_CONTENT_COPY_ROLE_ID?.trim() || "content-copy";
  const timeoutMs = intEnv("OPENCLAW_CONTENT_COPY_TIMEOUT_MS", gw.gatewayTimeoutMs);
  const maxAttempts = copyLimitRetryMaxAttempts();
  const client = new WebSocketOpenClawSessionsClient(gw.sessions, timeoutMs);
  let correction: string | undefined;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptIdLoop = `${Date.now()}-${attempt}`;
      const sessionKeyLoop =
        `agent:${agentId}:copy:${params.task_id}:${params.run_id}:${params.item.topic_id}:${attemptIdLoop}`.replace(
          /[^a-zA-Z0-9:_-]/g,
          "_",
        );

      const message = buildCopyMessage(
        correction ? { ...params, correction } : params,
      );
      const response = await client.run_agent({
        agent_id: agentId,
        message,
        timeout_ms: timeoutMs,
        idempotency_key: `step6-copy-${params.task_id}-${params.run_id}-${params.item.topic_id}-${attemptIdLoop}`.replace(
          /[^a-zA-Z0-9_-]/g,
          "_",
        ),
        label: `Step6 copy ${params.task_id}/${params.item.topic_id} attempt=${attempt}`,
        ...(gw.sessions.sessionTarget === "isolated" ? { session_key: sessionKeyLoop } : {}),
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonText(response.content)) as unknown;
      } catch {
        throw new Error("CONTENT_COPY_BAD_JSON: agent did not return parseable JSON");
      }

      try {
        const body = parseCopyRolePayload(parsed, { copyPlatforms: params.copy_platforms });
        if (attempt > 1) {
          // eslint-disable-next-line no-console
          console.warn(
            `[content-copy] ${params.task_id}/${params.item.topic_id}: limits OK after retry ${attempt}/${maxAttempts}`,
          );
        }
        return {
          topic_id: params.item.topic_id,
          title: params.item.title,
          ...body,
        };
      } catch (parseError) {
        const msg = parseError instanceof Error ? parseError.message : String(parseError);
        if (!isCopyDraftRetryableError(msg)) throw parseError;

        if (attempt < maxAttempts) {
          correction = msg.replace(/^CONTENT_COPY_DRAFT_LIMIT:\s*/, "").replace(
            /^CONTENT_COPY_DRAFT_MISSING_PLATFORMS:\s*/,
            "missing platforms: ",
          );
          // eslint-disable-next-line no-console
          console.warn(
            `[content-copy] ${params.task_id}/${params.item.topic_id}: ${msg} — retry ${attempt + 1}/${maxAttempts}`,
          );
          continue;
        }

        const body = parseCopyRolePayload(parsed, {
          validateLimits: false,
          copyPlatforms: params.copy_platforms,
        });
        const clamped = clampDraftsToLimits(body.drafts);
        validateDraftLimits(clamped, params.copy_platforms);
        // eslint-disable-next-line no-console
        console.warn(
          `[content-copy] ${params.task_id}/${params.item.topic_id}: limits still exceeded after ${maxAttempts} attempts; applied local clamp (${msg})`,
        );
        return {
          topic_id: params.item.topic_id,
          title: params.item.title,
          writing_angle: body.writing_angle,
          drafts: clamped,
          image_prompts: body.image_prompts,
        };
      }
    }

    throw new Error("CONTENT_COPY_LIMIT_RETRY_EXHAUSTED");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`CONTENT_COPY_ROLE_FAILED: ${msg}`);
  }
}
