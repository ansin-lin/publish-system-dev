import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publishSystemRoot = path.resolve(backendRoot, "..");

export type DashboardConfig = {
  port: number;
  /** Bind address; use 0.0.0.0 for LAN access. Default 127.0.0.1 (local only). */
  hostname: string;
  publishSystemRoot: string;
  openclawRoot: string;
  orchestratorConfigPath: string;
  frontendDistDir: string;
  serveFrontend: boolean;
  corsOrigins: string[];
};

function parsePort(raw: string | undefined): number {
  const n = Number(raw ?? "8787");
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid DASHBOARD_PORT: ${raw}`);
  }
  return n;
}

function parseHostname(raw: string | undefined): string {
  const host = (raw ?? "127.0.0.1").trim();
  if (!host) throw new Error("DASHBOARD_HOST must not be empty");
  return host;
}

function resolveOpenclawRoot(): string {
  const fromEnv = process.env.OPENCLAW_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(publishSystemRoot, "..");
}

function resolveOrchestratorConfigPath(): string {
  const fromEnv = process.env.PUBLISH_ORCHESTRATOR_CONFIG?.trim();
  if (fromEnv) {
    const resolved = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(publishSystemRoot, fromEnv);
    if (!fs.existsSync(resolved)) {
      throw new Error(`PUBLISH_ORCHESTRATOR_CONFIG not found: ${resolved}`);
    }
    return resolved;
  }
  const defaultPath = path.resolve(publishSystemRoot, "config", "publish.orchestrator.json");
  if (!fs.existsSync(defaultPath)) {
    throw new Error(`Missing orchestrator config: ${defaultPath}`);
  }
  return defaultPath;
}

export function loadDashboardConfig(): DashboardConfig {
  const corsRaw = process.env.DASHBOARD_CORS_ORIGINS?.trim();
  const corsOrigins = corsRaw
    ? corsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : ["http://localhost:5173", "http://127.0.0.1:5173"];

  const frontendDistDir = path.resolve(publishSystemRoot, "frontend", "dist");
  const serveFrontend =
    process.env.DASHBOARD_SERVE_STATIC === "1" ||
    process.env.DASHBOARD_SERVE_STATIC === "true" ||
    fs.existsSync(path.join(frontendDistDir, "index.html"));

  return {
    port: parsePort(process.env.DASHBOARD_PORT),
    hostname: parseHostname(process.env.DASHBOARD_HOST),
    publishSystemRoot,
    openclawRoot: resolveOpenclawRoot(),
    orchestratorConfigPath: resolveOrchestratorConfigPath(),
    frontendDistDir,
    serveFrontend,
    corsOrigins,
  };
}
