import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

import type { LoginContext, LoginResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

/**
 * Instagram 登录（仅手动）。
 * - 使用 runner 的持久化 Chrome profile
 * - 不读取账号 YAML、不自动填表
 * - 超时由 settings.loginTimeoutMs 控制
 */
export async function login(ctx: LoginContext): Promise<LoginResult> {
  const { page, artifacts, target, options, settings } = ctx;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const isLoggedIn = async (p: Page): Promise<boolean> => {
    try {
      const url = p.url();
      if (url.includes("/accounts/login")) return false;
      // 导航栏里通常存在 home / profile 入口；不同语言下用多选择器兜底
      const selectors = [
        "a[href='/']",
        "a[href^='/?']",
        "svg[aria-label='Home']",
        "svg[aria-label='主页']",
        "svg[aria-label='ホーム']",
        "a[href^='/" + "accounts/edit']",
        "input[placeholder*='搜索']",
        "input[placeholder*='Search']",
      ];
      for (const sel of selectors) {
        const loc = p.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });
  writeLog("opened login page");

  if (options.headless) {
    return {
      status: "login_timeout",
      platform: "instagram",
      profile: target.profile,
      error: "headless=true 无法手动登录，请用 headless=false",
      artifacts,
    };
  }

  const deadline = Date.now() + settings.loginTimeoutMs;
  while (Date.now() < deadline) {
    // 登录后可能出现通知弹窗，不点掉会影响后续操作；这里顺手点“後で/Not now”
    try {
      const notNow = page.locator("button:has-text('後で'), button:has-text('Not Now'), button:has-text('Not now')").first();
      if ((await notNow.count()) > 0 && (await notNow.isVisible().catch(() => false))) {
        await notNow.click({ timeout: 1500, force: true });
        writeLog("dismiss notifications dialog in login");
      }
    } catch {
      // ignore
    }
    if (await isLoggedIn(page)) {
      writeLog("manual login ok");
      return { status: "login_ok", platform: "instagram", profile: target.profile, artifacts };
    }
    await page.waitForTimeout(2000);
  }

  const msg = `等待手动登录超时（${Math.floor(settings.loginTimeoutMs / 1000)}s）`;
  writeLog(msg);
  return { status: "login_timeout", platform: "instagram", profile: target.profile, error: msg, artifacts };
}

