import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Account } from "./types.js";

/**
 * 账号文件路径：accounts/<platform>/<profile>.yaml
 */
export function accountFilePath(accountsDir: string, platform: string, profile: string): string {
  return path.resolve(accountsDir, platform, `${profile}.yaml`);
}

/**
 * 读取 YAML 账号文件。
 *
 * 支持结构：
 * - 顶层：username/password/phone
 * - 或 login: { username/password/phone }
 */
export function loadAccount(accountsDir: string, platform: string, profile: string): Account {
  const filePath = accountFilePath(accountsDir, platform, profile);
  if (!fs.existsSync(filePath)) {
    // 账号文件已不再强依赖：所有平台默认走“仅手动登录 + storageState”。
    return {};
  }
  const parsed = YAML.parse(fs.readFileSync(filePath, "utf-8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`账号文件必须是 YAML 映射(dict)：${filePath}`);
  }
  const login = (parsed as any).login ?? parsed;
  if (!login || typeof login !== "object") {
    throw new Error(`账号文件的 login 必须是 YAML 映射(dict)：${filePath}`);
  }

  const username = typeof login.username === "string" && login.username.trim() ? login.username.trim() : undefined;
  const password = typeof login.password === "string" && login.password.trim() ? login.password.trim() : undefined;
  const phone = typeof login.phone === "string" && login.phone.trim() ? login.phone.trim() : undefined;

  return { username, password, phone };
}

