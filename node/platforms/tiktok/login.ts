import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

import type { LoginContext, LoginResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

const HOME_URL = "https://www.tiktok.com/";
const LOGIN_URL = "https://www.tiktok.com/login";

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes("/login")) return false;
    // TikTok 登录后通常有头像按钮 / profile 链接等（多语言兜底）
    const selectors = [
      "a[href^='/@']",
      "a[href*='/profile']",
      "[data-e2e='profile-icon']",
      "[data-e2e='topbar-profile']",
      "img[alt*='profile']",
    ];
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return true;
    }
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

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  writeLog("opened tiktok login page");

  if (options.headless) {
    return {
      status: "login_timeout",
      platform: "tiktok",
      profile: target.profile,
      error: "headless=true 无法手动登录，请用 headless=false",
      artifacts,
    };
  }

  const deadline = Date.now() + settings.loginTimeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) {
      writeLog("manual login ok");
      return { status: "login_ok", platform: "tiktok", profile: target.profile, artifacts };
    }
    // 若用户已在其他标签/跳回主页，也视为继续轮询
    await page.waitForTimeout(2000);
    try {
      if (page.url().includes("/login")) {
        // 轻微提示用户可跳主页
        // 不做强制跳转，避免干扰手动登录
      }
    } catch {}
  }

  // 超时后导航到主页，便于用户看到当前状态
  try {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  } catch {}

  const msg = `等待手动登录超时（${Math.floor(settings.loginTimeoutMs / 1000)}s）`;
  writeLog(msg);
  return { status: "login_timeout", platform: "tiktok", profile: target.profile, error: msg, artifacts };
}

