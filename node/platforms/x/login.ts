import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

import type { LoginContext, LoginResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes("login") || url.includes("/i/flow/")) return false;
    const checks = [
      "a[href='/home']",
      "div[aria-label='Timeline: Your Home Timeline']",
      "div[contenteditable='true'][data-testid='tweetTextarea_0'][role='textbox']",
    ];
    for (const selector of checks) {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) return true;
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

  await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" });
  writeLog("opened login page");

  if (options.headless) {
    return {
      status: "login_timeout",
      platform: "x",
      profile: target.profile,
      error: "headless=true 无法手动登录，请用 headless=false",
      artifacts,
    };
  }

  const deadline = Date.now() + settings.loginTimeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) {
      writeLog("manual login ok");
      return { status: "login_ok", platform: "x", profile: target.profile, artifacts };
    }
    await page.waitForTimeout(2000);
  }

  const msg = `等待手动登录超时（${Math.floor(settings.loginTimeoutMs / 1000)}s）`;
  writeLog(msg);
  return { status: "login_timeout", platform: "x", profile: target.profile, error: msg, artifacts };
}

