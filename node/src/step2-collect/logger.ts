import fs from "node:fs";
import path from "node:path";
import { nowIsoJst } from "./time.js";

export function createCollectLogger(logPath: string) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  function append(level: string, message: string): void {
    fs.appendFileSync(logPath, `${nowIsoJst()} ${level} ${message}\n`, "utf-8");
  }

  return {
    info(message: string): void {
      append("INFO", message);
    },
    warn(message: string): void {
      append("WARN", message);
    },
    error(message: string): void {
      append("ERROR", message);
    },
  };
}
