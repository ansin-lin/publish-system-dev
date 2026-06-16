import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

import type { LoginContext, LoginResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

const STUDIO_URL = "https://studio.youtube.com/";
const LOGIN_HINT_URL = "https://accounts.google.com/";

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.startsWith(LOGIN_HINT_URL) || url.includes("ServiceLogin")) return false;
    // YouTube Studio 左侧导航（不同语言下都比较稳定）
    const checks = [
      "ytd-topbar-logo-renderer",
      "ytcp-app",
      "tp-yt-paper-icon-button[aria-label*='Create']",
      "tp-yt-paper-icon-button[aria-label*='作成']",
      "tp-yt-paper-icon-button[aria-label*='作成']",
      "a[href^='/channel/']",
    ];
    for (const sel of checks) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return true;
    }
    // 登录表单任一出现则认为未登录
    const email = page.locator("input[type='email']").first();
    if ((await email.count()) > 0 && (await email.isVisible().catch(() => false))) return false;
    return false;
  } catch {
    return false;
  }
}

export async function login(ctx: LoginContext): Promise<LoginResult> {
  const { page, artifacts, target, options, settings } = ctx;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  writeLog("opened youtube studio");

  if (options.headless) {
    return {
      status: "login_timeout",
      platform: "youtube",
      profile: target.profile,
      error: "headless=true 无法手动登录，请用 headless=false",
      artifacts,
    };
  }

  const deadline = Date.now() + settings.loginTimeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) {
      writeLog("manual login ok");
      return { status: "login_ok", platform: "youtube", profile: target.profile, artifacts };
    }
    await page.waitForTimeout(2000);
  }

  const msg = `等待手动登录超时（${Math.floor(settings.loginTimeoutMs / 1000)}s）`;
  writeLog(msg);
  return { status: "login_timeout", platform: "youtube", profile: target.profile, error: msg, artifacts };
}

