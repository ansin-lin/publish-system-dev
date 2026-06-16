import crypto from "node:crypto";
import type { JsonObject } from "../../step2-collect/types.js";
import {
  buildDeviceAuthPayloadV3,
  loadDeviceAuthToken,
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  storeDeviceAuthToken,
} from "./deviceIdentity.js";
import { logRoleGateway, type RoleGatewayLogContext } from "./roleGatewayLog.js";
import type {
  OpenClawAgentRunRequest,
  OpenClawAgentRunResult,
  OpenClawSessionsClient,
  OpenClawSessionsConfig,
  SessionsSendRequest,
  SessionsSendResult,
  SessionsSpawnRequest,
  SessionsSpawnResult,
} from "./types.js";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** OpenClaw gateway rejects agent run labels longer than 64 characters. */
function clampAgentRunLabel(label: string, maxLen = 64): string {
  const trimmed = label.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

function stringField(value: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

function resultObject(raw: JsonObject): JsonObject {
  const result = raw.result;
  if (isObject(result)) return result;
  return raw;
}

function contentFromPayload(payload: JsonObject): string {
  const direct = stringField(payload, ["content", "message", "text", "output", "response", "final", "finalText"]);
  if (direct) return direct;
  const message = payload.message;
  if (isObject(message)) {
    if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
      return JSON.stringify({ errorMessage: message.errorMessage, stopReason: message.stopReason });
    }
    const messageContent = message.content;
    if (typeof messageContent === "string" && messageContent.trim()) return messageContent.trim();
    if (Array.isArray(messageContent)) {
      const texts = textPartsFromAssistantContent(messageContent);
      const body = assistantBodyFromTextParts(texts);
      if (body) return body;
      const think = thinkingPartsFromAssistantContent(messageContent);
      const t = think.join("\n\n").trim();
      if (t) return t;
    }
  }
  if (typeof payload.errorMessage === "string" && payload.errorMessage.trim()) {
    return JSON.stringify({ errorMessage: payload.errorMessage, stopReason: payload.stopReason });
  }
  const result = payload.result;
  if (typeof result === "string" && result.trim()) return result.trim();
  if (isObject(result)) return JSON.stringify(result);
  return JSON.stringify(payload);
}

function isRunStatusOnly(payload: JsonObject): boolean {
  return typeof payload.runId === "string" && typeof payload.status === "string" && !("message" in payload) && !("content" in payload);
}

function textPartsFromAssistantContent(content: unknown[]): string[] {
  const parts: string[] = [];
  for (const item of content) {
    if (!isObject(item)) continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) parts.push(item.text.trim());
  }
  return parts;
}

function thinkingPartsFromAssistantContent(content: unknown[]): string[] {
  const parts: string[] = [];
  for (const item of content) {
    if (!isObject(item)) continue;
    if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking.trim()) parts.push(item.thinking.trim());
  }
  return parts;
}

function assistantBodyFromTextParts(texts: string[]): string {
  if (texts.length === 0) return "";
  if (texts.length === 1) return texts[0]!;
  const last = texts[texts.length - 1]!;
  if (last.trim().startsWith("{")) return last;
  const joined = texts.join("\n").trim();
  if (joined.includes("{") && joined.includes("}")) return joined;
  return last;
}

function contentFromMessage(value: unknown): string {
  if (!isObject(value)) return "";
  if (typeof value.errorMessage === "string" && value.errorMessage.trim()) {
    return JSON.stringify({ errorMessage: value.errorMessage, stopReason: value.stopReason });
  }
  const content = value.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const texts = textPartsFromAssistantContent(content);
    const body = assistantBodyFromTextParts(texts);
    if (body) return body;
    const think = thinkingPartsFromAssistantContent(content);
    return think.join("\n\n").trim();
  }
  return "";
}

function candidateMessages(payload: JsonObject): unknown[] {
  for (const key of ["messages", "entries", "history", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  const result = payload.result;
  if (isObject(result)) return candidateMessages(result);
  return [];
}

function contentFromHistory(payload: JsonObject, runId: string): string {
  const messages = candidateMessages(payload);
  for (const entry of [...messages].reverse()) {
    if (!isObject(entry)) continue;
    const message = isObject(entry.message) ? entry.message : entry;
    const role = typeof message.role === "string" ? message.role : typeof entry.role === "string" ? entry.role : "";
    const entryRunId = stringField(entry, ["runId", "run_id"]) || stringField(message, ["runId", "run_id"]);
    if (role && role !== "assistant") continue;
    if (entryRunId && entryRunId !== runId) continue;
    const text = contentFromMessage(message);
    if (text) return text;
  }
  return "";
}

function socketMessageText(data: MessageEvent["data"]): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf-8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf-8");
  return String(data);
}

function parseFrame(text: string): JsonObject {
  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed)) throw new Error("OpenClaw WebSocket frame must be a JSON object");
  return parsed;
}

function parseResponseFrame(frame: JsonObject, requestId: string): JsonObject | undefined {
  if (frame.type === "event") return undefined;
  if (frame.type !== "res") throw new Error(`OpenClaw WebSocket expected response frame, got ${String(frame.type)}`);
  const responseId = frame.id;
  if (responseId !== undefined && String(responseId) !== requestId) return undefined;
  if (frame.ok !== true) {
    const error = isObject(frame.error) ? frame.error : {};
    const message = typeof error.message === "string" ? error.message : JSON.stringify(error);
    throw new Error(message);
  }
  const payload = frame.payload;
  if (isObject(payload)) return payload;
  return { result: payload };
}

function buildRequestFrame(method: string, params: JsonObject): { frame: JsonObject; id: string } {
  const id = crypto.randomUUID();
  return {
    id,
    frame: {
      type: "req",
      id,
      method,
      params,
    },
  };
}

function buildConnectParams(config: OpenClawSessionsConfig, nonce: string): JsonObject {
  const identity = loadOrCreateDeviceIdentity();
  const storedToken = loadDeviceAuthToken(identity.deviceId, config.role)?.token;
  const resolvedDeviceToken = config.apiToken ? undefined : storedToken;
  const authToken = config.apiToken ?? resolvedDeviceToken;
  const signedAtMs = Date.now();
  const platform = process.platform;
  const authPayload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: config.clientId,
    clientMode: config.clientMode,
    role: config.role,
    scopes: config.scopes,
    signedAtMs,
    token: authToken ?? null,
    nonce,
    platform,
  });

  const params: JsonObject = {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: config.clientId,
      version: "publish-system",
      platform,
      mode: config.clientMode,
    },
    caps: [],
    role: config.role,
    scopes: config.scopes,
    device: {
      id: identity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
      signature: signDevicePayload(identity.privateKeyPem, authPayload),
      signedAt: signedAtMs,
      nonce,
    },
  };
  if (authToken || resolvedDeviceToken) {
    params.auth = {
      token: authToken,
      deviceToken: resolvedDeviceToken,
    };
  }
  return params;
}

function persistDeviceTokenFromConnectPayload(payload: JsonObject, config: OpenClawSessionsConfig): void {
  const auth = payload.auth;
  if (!isObject(auth) || typeof auth.deviceToken !== "string" || !auth.deviceToken.trim()) return;
  const identity = loadOrCreateDeviceIdentity();
  const role = typeof auth.role === "string" && auth.role.trim() ? auth.role.trim() : config.role;
  const scopes = Array.isArray(auth.scopes) ? auth.scopes.map(String) : config.scopes;
  storeDeviceAuthToken({ deviceId: identity.deviceId, role, token: auth.deviceToken.trim(), scopes });
}

async function rpcCall(
  config: OpenClawSessionsConfig,
  method: string,
  params: JsonObject,
  timeoutMs: number,
  logCtx?: RoleGatewayLogContext,
): Promise<JsonObject> {
  const wsUrl = config.wsUrl;
  if (!wsUrl) throw new Error("OpenClaw Sessions WebSocket URL is not configured");
  if (typeof WebSocket === "undefined") throw new Error("Global WebSocket is not available in this Node.js runtime");

  const rpcStarted = Date.now();
  if (logCtx) {
    logRoleGateway("info", `rpc ${method} begin`, logCtx, { timeout_ms: timeoutMs });
  }

  return await new Promise<JsonObject>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let authenticated = false;
    let activeRequestId = "";
    let activeRequestSent = false;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      socket.close();
      finish(() => reject(new Error(`OpenClaw WebSocket RPC timeout: ${method} (${timeoutMs}ms)`)));
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);

    const sendRequest = (requestMethod: string, requestParams: JsonObject): string => {
      const { frame, id } = buildRequestFrame(requestMethod, requestParams);
      socket.send(JSON.stringify(frame));
      return id;
    };

    socket.addEventListener("message", (event) => {
      try {
        const frame = parseFrame(socketMessageText(event.data));
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const payloadValue = frame.payload;
          const nonce = isObject(payloadValue) && typeof payloadValue.nonce === "string" ? payloadValue.nonce.trim() : "";
          if (!nonce) throw new Error("OpenClaw WebSocket connect.challenge missing nonce");
          activeRequestId = sendRequest("connect", buildConnectParams(config, nonce));
          return;
        }

        if (frame.type === "event") return;

        if (!authenticated) {
          const connectPayload = parseResponseFrame(frame, activeRequestId);
          if (!connectPayload) return;
          persistDeviceTokenFromConnectPayload(connectPayload, config);
          authenticated = true;
          activeRequestId = sendRequest(method, params);
          activeRequestSent = true;
          return;
        }

        if (!activeRequestSent) return;
        const response = parseResponseFrame(frame, activeRequestId);
        if (!response) return;
        socket.close();
        finish(() => resolve(response));
      } catch (error) {
        socket.close();
        finish(() => reject(error));
      }
    });

    socket.addEventListener("error", () => {
      finish(() => reject(new Error(`OpenClaw WebSocket RPC connection failed: ${wsUrl}`)));
    });

    socket.addEventListener("close", () => {
      finish(() => reject(new Error(`OpenClaw WebSocket RPC closed before response: ${method}`)));
    });
  }).then((payload) => {
    if (logCtx) {
      logRoleGateway("info", `rpc ${method} ok`, logCtx, { duration_ms: Date.now() - rpcStarted });
    }
    return payload;
  });
}

export class WebSocketOpenClawSessionsClient implements OpenClawSessionsClient {
  constructor(
    private readonly config: OpenClawSessionsConfig,
    private readonly timeoutMs: number,
  ) {}

  async sessions_spawn(input: SessionsSpawnRequest): Promise<SessionsSpawnResult> {
    return {
      session_id: crypto.randomUUID(),
      raw: {
        mapped_to: "agent",
        role_id: input.role_id,
        sessionTarget: input.sessionTarget,
        metadata: input.metadata,
      },
    };
  }

  async sessions_send(input: SessionsSendRequest): Promise<SessionsSendResult> {
    const defaultAgent = process.env.OPENCLAW_SESSIONS_SEND_AGENT_ID?.trim() || "publish-orchestrator";
    const run = await this.run_agent({
      agent_id: defaultAgent,
      message: input.message,
      timeout_ms: input.timeout_ms,
      idempotency_key: input.session_id,
    });
    const result: SessionsSendResult = { content: run.content };
    if (run.raw) result.raw = run.raw;
    return result;
  }

  async run_agent(input: OpenClawAgentRunRequest): Promise<OpenClawAgentRunResult> {
    const runId = input.idempotency_key || crypto.randomUUID();
    const logCtx: RoleGatewayLogContext = {
      agent_id: input.agent_id,
      ...(input.label ? { label: input.label } : {}),
      ...(input.session_key ? { session_key: input.session_key } : {}),
    };
    const agentParams: JsonObject = {
      agentId: input.agent_id,
      message: input.message,
      timeout: input.timeout_ms,
      idempotencyKey: runId,
    };
    if (input.session_key) agentParams.sessionKey = input.session_key;
    if (input.label) agentParams.label = clampAgentRunLabel(input.label);

    const runStarted = Date.now();
    logRoleGateway("info", `run_agent start`, logCtx, {
      timeout_ms: input.timeout_ms,
      idempotency_key: runId,
    });

    let started: JsonObject;
    let waited: JsonObject;
    let waitPayload: JsonObject;
    let gatewayRunId = runId;
    let content = "";

    try {
      started = await rpcCall(this.config, this.config.agentMethod, agentParams, this.timeoutMs, logCtx);
      const startPayload = resultObject(started);
      gatewayRunId = stringField(startPayload, ["runId", "run_id", "id"]) || runId;
      waited = await rpcCall(
        this.config,
        this.config.agentWaitMethod,
        { runId: gatewayRunId, timeoutMs: input.timeout_ms },
        input.timeout_ms,
        logCtx,
      );
      waitPayload = resultObject(waited);
      if (input.session_key) {
      const historyLimit = this.config.chatHistoryLimit ?? 80;
        const history = await rpcCall(
          this.config,
          this.config.chatHistoryMethod,
          { sessionKey: input.session_key, limit: historyLimit },
          this.timeoutMs,
          logCtx,
        );
        content = contentFromHistory(resultObject(history), gatewayRunId);
      }
      if (!content && !isRunStatusOnly(waitPayload)) content = contentFromPayload(waitPayload);
      if (
        input.session_key &&
        content.trim().startsWith('{"errorMessage"') &&
        !isRunStatusOnly(waitPayload)
      ) {
        const alt = contentFromPayload(waitPayload);
        if (alt.trim() && !alt.trim().startsWith('{"errorMessage"')) content = alt;
      }
      if (!content) {
        content = JSON.stringify({
          ok: false,
          error: {
            code: "OPENCLAW_EMPTY_RESPONSE",
            message: "OpenClaw gateway agent finished without final text output",
            retryable: true,
          },
        });
        logRoleGateway("warn", "run_agent empty content", logCtx, { gateway_run_id: gatewayRunId });
      }
      logRoleGateway("info", `run_agent done`, logCtx, {
        duration_ms: Date.now() - runStarted,
        gateway_run_id: gatewayRunId,
        content_chars: content.length,
      });
      return {
        run_id: gatewayRunId,
        content,
        raw: waitPayload,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logRoleGateway(/timeout/i.test(msg) ? "warn" : "error", `run_agent fail: ${msg}`, logCtx, {
        duration_ms: Date.now() - runStarted,
      });
      throw error;
    }
  }
}
