import type { JsonObject } from "../../step2-collect/types.js";

export type OpenClawSessionsConfig = {
  wsUrl?: string;
  apiBaseUrl?: string;
  apiToken?: string;
  sessionTarget: string;
  agentMethod: string;
  agentWaitMethod: string;
  chatHistoryMethod: string;
  /** Max messages for chat.history when resolving assistant output (isolated sessions). */
  chatHistoryLimit?: number;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
};

export type OpenClawGatewayConfig = {
  sessions: OpenClawSessionsConfig;
  gatewayTimeoutMs: number;
};

export type SessionsSpawnRequest = {
  role_id: string;
  sessionTarget: string;
  metadata: JsonObject;
};

export type SessionsSpawnResult = {
  session_id: string;
  raw?: JsonObject;
};

export type SessionsSendRequest = {
  session_id: string;
  message: string;
  timeout_ms: number;
};

export type SessionsSendResult = {
  content: string;
  raw?: JsonObject;
};

export type OpenClawSessionsClient = {
  sessions_spawn(input: SessionsSpawnRequest): Promise<SessionsSpawnResult>;
  sessions_send(input: SessionsSendRequest): Promise<SessionsSendResult>;
  run_agent(input: OpenClawAgentRunRequest): Promise<OpenClawAgentRunResult>;
};

export type OpenClawAgentRunRequest = {
  agent_id: string;
  message: string;
  timeout_ms: number;
  idempotency_key: string;
  session_key?: string;
  label?: string;
};

export type OpenClawAgentRunResult = {
  run_id: string;
  content: string;
  raw?: JsonObject;
};
