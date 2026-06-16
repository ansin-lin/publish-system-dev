import type { JsonObject } from "../step2-collect/types.js";
import { loadOpenClawGatewayConfig } from "../shared/analyze/config.js";
import { WebSocketOpenClawSessionsClient } from "../shared/analyze/sessionsClient.js";
import { extractJsonText } from "../step4-approval/json.js";

const RESEARCH_KEYS = [
  "keywords",
  "articles",
  "images",
  "videos",
  "core_points",
  "writing_angles",
] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function minResearchArrayLength(): number {
  return intEnv("PUBLISH_ORCH_RESEARCH_MIN_ITEMS", 3);
}

function buildContentResearchMessage(input: {
  title: string;
  topic_id: string;
  source_platform?: string;
  source_url?: string;
  collect_hint?: string;
  task_id: string;
  run_id: string;
}): string {
  return JSON.stringify(
    {
      role: "content-research",
      task: "generate_research_brief",
      instruction: [
        "Generate IT promotion content research for the given title.",
        "Reply with JSON ONLY (no markdown fence, no prose before/after).",
        'Root object must include key "research" with six string arrays:',
        "keywords, articles, images, videos, core_points, writing_angles.",
        `Each array must have at least ${minResearchArrayLength()} non-empty strings.`,
        "Strings are creative briefs / search directions, not verified URLs or statistics.",
        "Follow IT promotion rules in workspace-content-research/AGENTS.md and publish-system memo.md.",
      ].join(" "),
      title: input.title,
      topic_id: input.topic_id,
      source_platform: input.source_platform || undefined,
      source_url: input.source_url || undefined,
      collect_hint: input.collect_hint || undefined,
      task_id: input.task_id,
      run_id: input.run_id,
    },
    null,
    2,
  );
}

export function parseAndValidateResearchPayload(parsed: unknown): JsonObject {
  if (!isObject(parsed)) {
    throw new Error("CONTENT_RESEARCH_RESPONSE_NOT_OBJECT");
  }
  if (parsed.ok === false) {
    const err = parsed.error;
    const msg =
      isObject(err) && typeof err.message === "string" ? err.message : "content-research returned ok:false";
    throw new Error(msg);
  }
  const research = parsed.research;
  if (!isObject(research)) {
    throw new Error("CONTENT_RESEARCH_MISSING_RESEARCH_KEY");
  }
  const minLen = minResearchArrayLength();
  for (const key of RESEARCH_KEYS) {
    const arr = research[key];
    if (!Array.isArray(arr) || arr.length < minLen) {
      throw new Error(`CONTENT_RESEARCH_${key.toUpperCase()}_TOO_SHORT`);
    }
    for (const item of arr) {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`CONTENT_RESEARCH_${key.toUpperCase()}_INVALID_ENTRY`);
      }
    }
  }
  return research;
}

export type ContentResearchInput = {
  title: string;
  topic_id: string;
  source_platform?: string;
  source_url?: string;
  collect_hint?: string;
  task_id: string;
  run_id: string;
};

export async function runContentResearchRole(input: ContentResearchInput): Promise<JsonObject> {
  const title = input.title.trim();
  if (!title) throw new Error("CONTENT_RESEARCH_TITLE_REQUIRED");

  const gw = loadOpenClawGatewayConfig();
  if (!gw.sessions.apiToken || !gw.sessions.wsUrl) {
    throw new Error(
      "OpenClaw gateway not configured for content-research (set OPENCLAW_SESSIONS_API_* or openclaw.json gateway.auth.token)",
    );
  }

  const agentId = process.env.OPENCLAW_CONTENT_RESEARCH_ROLE_ID?.trim() || "content-research";
  const timeoutMs = intEnv("OPENCLAW_CONTENT_RESEARCH_TIMEOUT_MS", gw.gatewayTimeoutMs);
  const attemptId = `${Date.now()}`;
  const sessionKey =
    `agent:${agentId}:research:${input.task_id}:${input.run_id}:${input.topic_id}:${attemptId}`.replace(
      /[^a-zA-Z0-9:_-]/g,
      "_",
    );

  const message = buildContentResearchMessage(input);
  const client = new WebSocketOpenClawSessionsClient(gw.sessions, timeoutMs);
  try {
    const response = await client.run_agent({
      agent_id: agentId,
      message,
      timeout_ms: timeoutMs,
      idempotency_key: `step5-research-${input.task_id}-${input.run_id}-${input.topic_id}-${attemptId}`.replace(
        /[^a-zA-Z0-9_-]/g,
        "_",
      ),
      label: `Step5 research ${input.task_id}/${input.topic_id}`,
      ...(gw.sessions.sessionTarget === "isolated" ? { session_key: sessionKey } : {}),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonText(response.content)) as unknown;
    } catch {
      throw new Error("CONTENT_RESEARCH_BAD_JSON: agent did not return parseable JSON");
    }
    return parseAndValidateResearchPayload(parsed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`CONTENT_RESEARCH_ROLE_FAILED: ${msg}`);
  }
}
