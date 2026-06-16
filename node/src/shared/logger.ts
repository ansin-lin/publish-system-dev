import fs from "node:fs";
import path from "node:path";
import { nowIso } from "./time.js";

/**
 * 最小日志器：
 * - stdout 方便 OpenClaw 采集
 * - 同时追加写入 artifacts/run.log 方便排查
 */
export function createLogger(logPath: string) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  function append(line: string) {
    fs.appendFileSync(logPath, line + "\n", "utf-8");
  }

  function info(message: string) {
    const line = `[${nowIso()}] ${message}`;
    // eslint-disable-next-line no-console
    console.log(line);
    append(line);
  }

  function warn(message: string) {
    const line = `[${nowIso()}] WARN ${message}`;
    // eslint-disable-next-line no-console
    console.warn(line);
    append(line);
  }

  function error(message: string) {
    const line = `[${nowIso()}] ERROR ${message}`;
    // eslint-disable-next-line no-console
    console.error(line);
    append(line);
  }

  return { info, warn, error };
}

