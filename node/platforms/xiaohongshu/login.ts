import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

import type { LoginContext, LoginResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

const HOME_URL = "https://creator.xiaohongshu.com/new/home";
const LOGIN_URL = "https://creator.xiaohongshu.com/login";

async function isLoggedIn(page: Page): Promise<boolean> {
  const checks = [
    (await page.locator("text=发布笔记").count()) > 0,
    (await page.locator("text=上传图文").count()) > 0,
    (await page.locator("text=笔记管理").count()) > 0,
    page.url().includes("creator.xiaohongshu.com") && (await page.locator("text=草稿箱").count()) > 0,
  ];
  return checks.some(Boolean);
}

export async function login(ctx: LoginContext): Promise<LoginResult> {
  const { page, artifacts, target, options, settings } = ctx;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  writeLog("opened login page");

  if (options.headless) {
    return {
      status: "login_timeout",
      platform: "xiaohongshu",
      profile: target.profile,
      error: "headless=true 无法手动登录，请用 headless=false",
      artifacts,
    };
  }

  const deadline = Date.now() + settings.loginTimeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) {
      writeLog("manual login ok");
      return { status: "login_ok", platform: "xiaohongshu", profile: target.profile, artifacts };
    }
    await page.waitForTimeout(2000);
  }

  // 再访问一次 home，便于用户看到当前位置
  try {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  } catch {}

  const msg = `等待手动登录超时（${Math.floor(settings.loginTimeoutMs / 1000)}s）`;
  writeLog(msg);
  return { status: "login_timeout", platform: "xiaohongshu", profile: target.profile, error: msg, artifacts };
}

