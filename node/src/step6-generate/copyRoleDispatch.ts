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

function formatLimitCorrectionMessage(rawError: string): string {
  const detail = rawError
    .replace(/^CONTENT_COPY_DRAFT_LIMIT:\s*/, "")
    .replace(/^CONTENT_COPY_DRAFT_MISSING_PLATFORMS:\s*/, "missing platforms: ");
  return (
    `Previous output violated platform limits: ${detail}. ` +
    "Rewrite title/body to fit by rephrasing (shorter wording, same meaning). " +
    "Do NOT exceed limits; orchestrator never accepts mechanical truncation."
  );
}

function buildPlatformCharLimitsPayload(platformIds: string[]): Record<string, { title_max?: number; body_max: number }> {
  const limitsMap = copyPlatformLimits(platformIds);
  const out: Record<string, { title_max?: number; body_max: number }> = {};
  for (const id of platformIds) {
    const limits = limitsMap[id];
    if (!limits) continue;
    out[id] = {
      body_max: limits.bodyMax,
      ...(limits.titleMax !== undefined ? { title_max: limits.titleMax } : {}),
    };
  }
  return out;
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

export function isCopyConstraintViolationError(message: string): boolean {
  return (
    message.includes("CONTENT_COPY_DRAFT_LIMIT") ||
    message.includes("CONTENT_COPY_DRAFT_MISSING_PLATFORMS") ||
    message.includes("CONTENT_COPY_CONSTRAINT_RETRY_EXHAUSTED") ||
    message.includes("CONTENT_COPY_LIMIT_RETRY_EXHAUSTED")
  );
}

function copyConstraintRetryMaxAttempts(): number {
  const raw = process.env.PUBLISH_ORCH_COPY_CONSTRAINT_RETRY_MAX?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 10;
}

/** Retries for parse / schema issues (separate from constraint-limit retries). */
function copyParseRetryMaxAttempts(): number {
  const raw = process.env.PUBLISH_ORCH_COPY_PARSE_RETRY_MAX?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  const legacy = process.env.PUBLISH_ORCH_COPY_LIMIT_RETRY_MAX?.trim();
  if (legacy) {
    const n = Number.parseInt(legacy, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 3;
}

function isCopyParseRetryableError(message: string): boolean {
  return (
    message.includes("CONTENT_COPY_BAD_JSON") ||
    message.includes("CONTENT_COPY_DRAFTS_INVALID") ||
    message.includes("CONTENT_COPY_DRAFTS_EMPTY") ||
    message.includes("CONTENT_COPY_MISSING_WRITING_ANGLE") ||
    message.includes("CONTENT_COPY_RESPONSE_NOT_OBJECT") ||
    message.includes("CONTENT_COPY_REGENERATE_NO_DRAFT_FOR") ||
    message.includes("CONTENT_COPY_IMAGE_PROMPTS")
  );
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
        "Character limits are STRICT hard caps (Unicode code-point count). tags[] do NOT count toward body.",
        "Never exceed title_max/body_max in platform_char_limits — shorten by rewriting, not by cutting text.",
        ...localeLines,
        ...tagsLines,
        ...platformNotes,
        `image_prompts[]: exactly ${slotCount} entries (slot_id img_1..img_${slotCount}), shared asset pack for all platforms.`,
        `Each image prompt: English-first art direction; aspect_ratio ${aspect}; style tech editorial; all prompts on-topic.`,
        "research.images[4+] are reference only; orchestrator uses first merge slots.",
        "Follow workspace-content-copy/AGENTS.md and publish-system/docs/01_detailed_design/step6_copy_image_spec.md.",
        "Do not invent verified statistics or exploit tutorials.",
        ...(input.correction ?
          [
            `CORRECTION (must fix before resubmitting): ${input.correction}`,
            "Return the full JSON again (writing_angle, drafts, image_prompts).",
          ]
        : []),
      ].join(" "),
      platform_char_limits: buildPlatformCharLimitsPayload(input.copy_platforms),
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
  options?: { validateLimits?: boolean; copyPlatforms?: string[]; requireImagePrompts?: boolean },
): Omit<CopyItemResult, "topic_id" | "title"> {
  const validateLimits = options?.validateLimits !== false;
  const requireImagePrompts = options?.requireImagePrompts !== false;
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
      title: title || writing_angle,
      body,
      tags,
    });
  }
  if (!drafts.length) throw new Error("CONTENT_COPY_DRAFTS_INVALID");
  if (validateLimits) validateDraftLimits(drafts, requiredPlatforms);

  if (!requireImagePrompts) {
    return { writing_angle, drafts, image_prompts: [] };
  }

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

function formatRegenerateLimitHint(platform: string): string {
  const limits = copyPlatformLimits([platform])[platform];
  if (!limits) return "";
  const parts: string[] = [];
  if (limits.titleMax !== undefined) parts.push(`title ≤ ${limits.titleMax} chars (STRICT)`);
  parts.push(`body ≤ ${limits.bodyMax} chars (STRICT)`);
  return `${limits.label} (${platform}): ${parts.join(", ")}. Never exceed — rewrite shorter, do not truncate.`;
}

function buildRegenerateCopyMessage(input: {
  item: TopicResearchItem;
  task_id: string;
  run_id: string;
  target_platform: string;
  feedback: string;
  existing_drafts: CopyDraft[];
  correction?: string;
}): string {
  const limitsMap = copyPlatformLimits([input.target_platform]);
  const platform = normalizeCopyPlatform(input.target_platform);
  const limits = limitsMap[platform];
  const localeLines = buildPerPlatformCopyLocaleLines([platform]);
  const tagsLine = `${platform}: ${tagsInstructionForLocale(limits?.locale ?? getConfiguredCopyLocale(platform))}`;
  const satisfied = input.existing_drafts
    .filter((d) => normalizeCopyPlatform(d.platform) !== platform)
    .map((d) => ({
      platform: d.platform,
      title: d.title.slice(0, 120),
      body_preview: d.body.slice(0, 200),
    }));

  return JSON.stringify(
    {
      role: "content-copy",
      task: "regenerate_platform_copy",
      instruction: [
        "Regenerate copy for ONE platform only based on operator feedback.",
        "Reply with JSON ONLY (no markdown fence, no prose).",
        'Required shape: { "drafts": [ { "platform": "' + platform + '", "locale": "...", "title": "...", "body": "...", "tags": [] } ] }.',
        "writing_angle is optional. Do NOT include image_prompts.",
        `drafts must contain exactly one object with platform="${platform}" and non-empty body.`,
        `Target platform: ${platform}.`,
        formatRegenerateLimitHint(platform),
        ...localeLines,
        tagsLine,
        "Character limits are STRICT (Unicode code-point count); tags[] do not count toward body.",
        "Never exceed platform_char_limits — rewrite shorter, do not truncate.",
        `Operator feedback (must address): ${input.feedback}`,
        "Keep tone consistent with other platforms listed in satisfied_drafts_preview.",
        ...(input.correction ?
          [
            `CORRECTION (must fix before resubmitting): ${input.correction}`,
            "Return JSON with drafts[0] within platform_char_limits.",
          ]
        : []),
      ].join(" "),
      platform_char_limits: buildPlatformCharLimitsPayload([platform]),
      task_id: input.task_id,
      run_id: input.run_id,
      topic_id: input.item.topic_id,
      title: input.item.title,
      research: input.item.research,
      satisfied_drafts_preview: satisfied,
    },
    null,
    2,
  );
}

function pickDraftBodyField(d: JsonObject): string {
  for (const key of ["body", "text", "content", "caption", "post_body", "copy"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function isCopyRegenerateRetryableError(message: string): boolean {
  return isCopyConstraintViolationError(message) || isCopyParseRetryableError(message);
}

function copyAgentRunLabel(kind: "regen" | "copy", taskId: string, detail: string): string {
  const prefix = kind === "regen" ? "s6-copy-regen" : "s6-copy";
  const label = `${prefix} ${taskId}/${detail}`;
  return label.length <= 64 ? label : label.slice(0, 64);
}

async function runCopyAgentLoop<T>(params: {
  client: WebSocketOpenClawSessionsClient;
  agentId: string;
  timeoutMs: number;
  sessionTarget: string | undefined;
  logTag: string;
  buildMessage: (correction?: string) => string;
  parsePayload: (parsed: unknown) => T;
  idempotencyKey: (attemptId: string) => string;
  sessionKey: (attemptId: string) => string;
  label: (attemptId: string) => string;
}): Promise<T> {
  const maxConstraint = copyConstraintRetryMaxAttempts();
  const maxParse = copyParseRetryMaxAttempts();
  let constraintRetries = 0;
  let parseRetries = 0;
  let correction: string | undefined;
  let totalCalls = 0;

  while (true) {
    totalCalls += 1;
    if (totalCalls > maxConstraint + maxParse + 5) {
      throw new Error("CONTENT_COPY_RETRY_SAFETY_CAP");
    }

    const attemptId = `${Date.now()}-${totalCalls}`;
    const message = params.buildMessage(correction);
    const response = await params.client.run_agent({
      agent_id: params.agentId,
      message,
      timeout_ms: params.timeoutMs,
      idempotency_key: params.idempotencyKey(attemptId),
      label: params.label(attemptId),
      ...(params.sessionTarget === "isolated" ? { session_key: params.sessionKey(attemptId) } : {}),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonText(response.content)) as unknown;
    } catch {
      const msg = "CONTENT_COPY_BAD_JSON: agent did not return parseable JSON";
      parseRetries += 1;
      if (parseRetries > maxParse) {
        throw new Error(`CONTENT_COPY_PARSE_RETRY_EXHAUSTED: ${msg}`);
      }
      correction = msg;
      // eslint-disable-next-line no-console
      console.warn(`[${params.logTag}] ${msg} — parse retry ${parseRetries}/${maxParse}`);
      continue;
    }

    try {
      const result = params.parsePayload(parsed);
      if (constraintRetries > 0 || parseRetries > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[${params.logTag}] OK after constraint_retries=${constraintRetries} parse_retries=${parseRetries}`,
        );
      }
      return result;
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);

      if (isCopyConstraintViolationError(msg)) {
        constraintRetries += 1;
        if (constraintRetries > maxConstraint) {
          throw new Error(`CONTENT_COPY_CONSTRAINT_RETRY_EXHAUSTED: ${msg}`);
        }
        correction = formatLimitCorrectionMessage(msg);
        // eslint-disable-next-line no-console
        console.warn(
          `[${params.logTag}] ${msg} — constraint retry ${constraintRetries}/${maxConstraint} (does not count toward parse retries)`,
        );
        continue;
      }

      if (isCopyParseRetryableError(msg) || isCopyRegenerateRetryableError(msg)) {
        parseRetries += 1;
        if (parseRetries > maxParse) {
          throw new Error(`CONTENT_COPY_PARSE_RETRY_EXHAUSTED: ${msg}`);
        }
        correction = msg;
        // eslint-disable-next-line no-console
        console.warn(`[${params.logTag}] ${msg} — parse retry ${parseRetries}/${maxParse}`);
        continue;
      }

      throw parseError;
    }
  }
}

export function parseCopyRegeneratePayload(
  parsed: unknown,
  targetPlatform: string,
  options?: { validateLimits?: boolean },
): { drafts: CopyDraft[] } {
  const validateLimits = options?.validateLimits !== false;
  const platform = normalizeCopyPlatform(targetPlatform);
  const limitsMap = copyPlatformLimits([platform]);
  const limits = limitsMap[platform];

  if (!isObject(parsed)) throw new Error("CONTENT_COPY_RESPONSE_NOT_OBJECT");
  if (parsed.ok === false) {
    const err = parsed.error;
    const msg =
      isObject(err) && typeof err.message === "string" ? err.message : "content-copy returned ok:false";
    throw new Error(msg);
  }

  const writing_angle = typeof parsed.writing_angle === "string" ? parsed.writing_angle.trim() : "";

  const draftsRaw = parsed.drafts;
  if (!Array.isArray(draftsRaw) || draftsRaw.length === 0) {
    throw new Error("CONTENT_COPY_DRAFTS_EMPTY");
  }

  const candidates: CopyDraft[] = [];
  for (const d of draftsRaw) {
    if (!isObject(d)) continue;
    const body = pickDraftBodyField(d);
    if (!body) continue;

    let plat =
      typeof d.platform === "string" && d.platform.trim() ?
        normalizeCopyPlatform(d.platform.trim())
      : "";
    if (!plat && draftsRaw.length === 1) plat = platform;

    const platLimits = limitsMap[plat];
    const locale =
      typeof d.locale === "string" && d.locale.trim() ?
        d.locale.trim()
      : platLimits?.locale ?? limits?.locale ?? getConfiguredCopyLocale(platform);

    const titleRaw = typeof d.title === "string" ? d.title.trim() : "";
    const title = titleRaw || writing_angle;

    const tags = Array.isArray(d.tags) ?
      d.tags.filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
    : [];

    candidates.push({
      platform: plat || platform,
      locale,
      title,
      body,
      tags,
    });
  }

  if (!candidates.length) {
    throw new Error("CONTENT_COPY_DRAFTS_INVALID");
  }

  let drafts = candidates.filter((d) => normalizeCopyPlatform(d.platform) === platform);
  if (!drafts.length && candidates.length === 1) {
    drafts = [{ ...candidates[0]!, platform, locale: candidates[0]!.locale || limits?.locale || getConfiguredCopyLocale(platform) }];
  }
  if (!drafts.length) {
    const seen = [...new Set(candidates.map((d) => d.platform))].join(", ");
    throw new Error(`CONTENT_COPY_REGENERATE_NO_DRAFT_FOR: ${platform} (got: ${seen})`);
  }

  if (validateLimits) validateDraftLimits(drafts, [platform]);
  return { drafts };
}

export async function runContentCopyRegenerateRole(params: {
  item: TopicResearchItem;
  task_id: string;
  run_id: string;
  target_platform: string;
  feedback: string;
  existing_drafts: CopyDraft[];
}): Promise<{ drafts: CopyDraft[] }> {
  const gw = loadOpenClawGatewayConfig();
  if (!gw.sessions.apiToken || !gw.sessions.wsUrl) {
    throw new Error(
      "OpenClaw gateway not configured for content-copy (set OPENCLAW_SESSIONS_API_* or openclaw.json gateway.auth.token)",
    );
  }

  const agentId = process.env.OPENCLAW_CONTENT_COPY_ROLE_ID?.trim() || "content-copy";
  const timeoutMs = intEnv("OPENCLAW_CONTENT_COPY_TIMEOUT_MS", gw.gatewayTimeoutMs);
  const client = new WebSocketOpenClawSessionsClient(gw.sessions, timeoutMs);
  const platform = normalizeCopyPlatform(params.target_platform);

  try {
    return await runCopyAgentLoop({
      client,
      agentId,
      timeoutMs,
      sessionTarget: gw.sessions.sessionTarget,
      logTag: `content-copy-regen ${params.task_id}/${platform}`,
      buildMessage: (correction) =>
        buildRegenerateCopyMessage(correction ? { ...params, correction } : params),
      parsePayload: (parsed) => parseCopyRegeneratePayload(parsed, platform),
      idempotencyKey: (attemptId) =>
        `step6-copy-regen-${params.task_id}-${params.run_id}-${platform}-${attemptId}`.replace(
          /[^a-zA-Z0-9_-]/g,
          "_",
        ),
      sessionKey: (attemptId) =>
        `agent:${agentId}:copy-regen:${params.task_id}:${params.run_id}:${platform}:${attemptId}`.replace(
          /[^a-zA-Z0-9:_-]/g,
          "_",
        ),
      label: () => copyAgentRunLabel("regen", params.task_id, platform),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`CONTENT_COPY_REGENERATE_FAILED: ${msg}`);
  }
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
  const client = new WebSocketOpenClawSessionsClient(gw.sessions, timeoutMs);

  try {
    const body = await runCopyAgentLoop({
      client,
      agentId,
      timeoutMs,
      sessionTarget: gw.sessions.sessionTarget,
      logTag: `content-copy ${params.task_id}/${params.item.topic_id}`,
      buildMessage: (correction) => buildCopyMessage(correction ? { ...params, correction } : params),
      parsePayload: (parsed) => parseCopyRolePayload(parsed, { copyPlatforms: params.copy_platforms }),
      idempotencyKey: (attemptId) =>
        `step6-copy-${params.task_id}-${params.run_id}-${params.item.topic_id}-${attemptId}`.replace(
          /[^a-zA-Z0-9_-]/g,
          "_",
        ),
      sessionKey: (attemptId) =>
        `agent:${agentId}:copy:${params.task_id}:${params.run_id}:${params.item.topic_id}:${attemptId}`.replace(
          /[^a-zA-Z0-9:_-]/g,
          "_",
        ),
      label: () => copyAgentRunLabel("copy", params.task_id, params.item.topic_id),
    });
    return {
      topic_id: params.item.topic_id,
      title: params.item.title,
      ...body,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`CONTENT_COPY_ROLE_FAILED: ${msg}`);
  }
}
