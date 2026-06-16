import type { OpenClawGatewayConfig, OpenClawSessionsConfig } from "./types.js";
import { readGatewayFromOpenClawJson } from "./openclawJsonGateway.js";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function toWsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("ws://") || value.startsWith("wss://")) return value;
  if (value.startsWith("http://")) return `ws://${value.slice("http://".length)}`;
  if (value.startsWith("https://")) return `wss://${value.slice("https://".length)}`;
  return value;
}

function csvEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

/**
 * OpenClaw gateway (WebSocket RPC) for tools such as publish-orchestrator Slack delivery.
 * analyzer-role has been removed from the pipeline.
 */
export function loadOpenClawGatewayConfig(): OpenClawGatewayConfig {
  let apiBaseUrl = stringEnv("OPENCLAW_SESSIONS_API_BASE_URL");
  let apiToken = stringEnv("OPENCLAW_SESSIONS_API_TOKEN");

  if (!apiBaseUrl || !apiToken) {
    const fromJson = readGatewayFromOpenClawJson();
    if (fromJson) {
      if (!apiBaseUrl) apiBaseUrl = fromJson.apiBaseUrl;
      if (!apiToken && fromJson.apiToken) apiToken = fromJson.apiToken;
    }
  }

  const wsUrl = toWsUrl(stringEnv("OPENCLAW_SESSIONS_WS_URL") ?? apiBaseUrl);
  const sessions: OpenClawSessionsConfig = {
    sessionTarget: process.env.OPENCLAW_GATEWAY_SESSION_TARGET?.trim() || process.env.OPENCLAW_ANALYZER_SESSION_TARGET?.trim() || "isolated",
    agentMethod: process.env.OPENCLAW_AGENT_METHOD?.trim() || process.env.OPENCLAW_SESSIONS_SPAWN_METHOD?.trim() || "agent",
    agentWaitMethod: process.env.OPENCLAW_AGENT_WAIT_METHOD?.trim() || process.env.OPENCLAW_SESSIONS_SEND_METHOD?.trim() || "agent.wait",
    chatHistoryMethod: process.env.OPENCLAW_CHAT_HISTORY_METHOD?.trim() || "chat.history",
    chatHistoryLimit: intEnv("OPENCLAW_CHAT_HISTORY_LIMIT", 80),
    clientId: process.env.OPENCLAW_GATEWAY_CLIENT_ID?.trim() || "gateway-client",
    clientMode: process.env.OPENCLAW_GATEWAY_CLIENT_MODE?.trim() || "backend",
    role: process.env.OPENCLAW_GATEWAY_ROLE?.trim() || "operator",
    scopes: csvEnv("OPENCLAW_GATEWAY_SCOPES", ["operator.admin"]),
  };
  if (apiBaseUrl) sessions.apiBaseUrl = apiBaseUrl;
  if (wsUrl) sessions.wsUrl = wsUrl;
  if (apiToken) sessions.apiToken = apiToken;

  const gatewayTimeoutMs = intEnv("OPENCLAW_GATEWAY_TIMEOUT_MS", intEnv("OPENCLAW_ANALYZER_ROLE_TIMEOUT_MS", 600_000));

  return { sessions, gatewayTimeoutMs };
}
