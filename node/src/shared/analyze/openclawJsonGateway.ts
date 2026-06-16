import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OpenClawJsonGatewayCredentials = {
  apiBaseUrl: string;
  apiToken?: string;
  configPath: string;
};

function isDisabled(): boolean {
  const raw = process.env.OPENCLAW_GATEWAY_CONFIG_FROM_JSON?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "no";
}

function defaultConfigPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "openclaw.json");
}

function candidatePaths(): string[] {
  const out: string[] = [];
  const push = (p: string | undefined) => {
    if (!p) return;
    const r = path.resolve(p);
    if (!out.includes(r)) out.push(r);
  };
  push(process.env.OPENCLAW_CONFIG?.trim());
  const home = process.env.OPENCLAW_HOME?.trim();
  if (home) push(path.join(home, "openclaw.json"));
  push(defaultConfigPath());
  push(path.join(os.homedir(), ".openclaw", "openclaw.json"));
  return out;
}

export function readGatewayFromOpenClawJson(configPath?: string): OpenClawJsonGatewayCredentials | null {
  if (isDisabled()) return null;
  const resolved =
    configPath?.trim() || candidatePaths().find((p) => fs.existsSync(p)) || candidatePaths()[0];
  if (!resolved || !fs.existsSync(resolved)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const gateway = (parsed as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) return null;

  const gw = gateway as Record<string, unknown>;
  const port = typeof gw.port === "number" && Number.isFinite(gw.port) ? gw.port : 18789;
  const apiBaseUrl = `http://127.0.0.1:${port}`;

  let apiToken: string | undefined;
  const auth = gw.auth;
  if (auth && typeof auth === "object" && !Array.isArray(auth)) {
    const authObj = auth as Record<string, unknown>;
    if (authObj.mode === "token" && typeof authObj.token === "string" && authObj.token.trim()) {
      apiToken = authObj.token.trim();
    }
  }

  const out: OpenClawJsonGatewayCredentials = { apiBaseUrl, configPath: resolved };
  if (apiToken) out.apiToken = apiToken;
  return out;
}
