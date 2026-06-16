import fs from "node:fs";
import path from "node:path";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";

function logsDir(): string {
  const fromEnv = process.env.PUBLISH_ORCH_LOGS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  try {
    return loadPublishOrchestratorConfig().paths.logs_dir;
  } catch {
    const cwd = process.env.PUBLISH_ORCH_CLI_CWD?.trim() || process.cwd();
    return path.resolve(cwd, "..", "logs");
  }
}

function logFilePath(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(logsDir(), `step4-slack-${y}${m}${day}.log`);
}

function loggingEnabled(): boolean {
  const raw = process.env.PUBLISH_ORCH_STEP4_SLACK_LOG?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export function appendStep4SlackLog(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  if (!loggingEnabled()) return;
  const payload = { at: new Date().toISOString(), event, ...fields };
  try {
    const dir = logsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logFilePath(), `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // best-effort
  }
}
