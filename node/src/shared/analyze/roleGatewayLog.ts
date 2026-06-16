import fs from "node:fs";
import path from "node:path";

export type RoleGatewayLogContext = {
  agent_id: string;
  label?: string;
  session_key?: string;
  task_id?: string;
  topic_id?: string;
  run_id?: string;
};

function logsDir(): string {
  const fromEnv = process.env.PUBLISH_ORCH_LOGS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const cwd = process.env.PUBLISH_ORCH_CLI_CWD?.trim() || process.cwd();
  return path.resolve(cwd, "..", "logs");
}

function loggingEnabled(): boolean {
  const raw = process.env.PUBLISH_ORCH_ROLE_GATEWAY_LOG?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function logFilePath(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(logsDir(), `role-gateway-${y}${m}${day}.log`);
}

function appendLine(line: string): void {
  if (!loggingEnabled()) return;
  try {
    const dir = logsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logFilePath(), `${line}\n`, "utf8");
  } catch {
    // best-effort file log
  }
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return "";
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return "";
  }
}

export function logRoleGateway(
  level: "info" | "warn" | "error",
  message: string,
  ctx: RoleGatewayLogContext,
  extra?: Record<string, unknown>,
): void {
  if (!loggingEnabled() && level === "info") return;
  const ts = new Date().toISOString();
  const label = ctx.label || ctx.agent_id;
  const ids =
    [ctx.task_id, ctx.topic_id, ctx.run_id].filter(Boolean).join("/") || "-";
  const line = `${ts} [${level}] [${label}] [${ids}] ${message}${formatExtra(extra)}`;
  appendLine(line);
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export async function withRoleGatewayTiming<T>(
  ctx: RoleGatewayLogContext,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  logRoleGateway("info", `start timeout_ms=${timeoutMs}`, ctx, {
    session_key: ctx.session_key,
  });
  try {
    const result = await fn();
    logRoleGateway("info", `ok duration_ms=${Date.now() - started}`, ctx);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const timedOut = /timeout/i.test(msg);
    logRoleGateway(timedOut ? "warn" : "error", `fail duration_ms=${Date.now() - started}: ${msg}`, ctx, {
      timed_out: timedOut,
    });
    throw error;
  }
}
