import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { buildArtifacts, saveResult } from "./artifacts.js";
import { loadAccount } from "./accounts.js";
import { createLogger } from "./logger.js";
import { ensureParentDir, storageStatePath } from "./storage.js";
import type { LoginResult, PlatformId, PlatformLogin, Settings } from "./types.js";

function persistentProfileDir(chromeProfilesDir: string, platform: PlatformId, profile: string): string {
  return path.resolve(chromeProfilesDir, platform, profile);
}

async function importPlatformLogin(platform: PlatformId): Promise<PlatformLogin> {
  const modulePath = path.resolve("platforms", platform, "login.ts");
  const url = new URL(`file:///${modulePath.replace(/\\\\/g, "/")}`).toString();
  const mod = await import(url);
  if (typeof (mod as any).login !== "function") {
    throw new Error(`平台登录模块必须导出 login(ctx)：${modulePath}`);
  }
  return (mod as any).login as PlatformLogin;
}

export async function runLogin(params: {
  settings: Settings;
  platform: PlatformId;
  profile: string;
  headless: boolean;
  timeoutMs?: number;
}): Promise<LoginResult> {
  const { settings, platform, profile, headless } = params;
  const timeoutMs = params.timeoutMs ?? settings.loginTimeoutMs;

  const artifacts = buildArtifacts(settings.artifactsDir, "login", platform, profile);
  const logger = createLogger(artifacts.logPath);

  const statePath = storageStatePath(settings.storageDir, platform, profile);
  ensureParentDir(statePath);

  const account = loadAccount(settings.accountsDir, platform, profile);
  const login = await importPlatformLogin(platform);

  logger.info(`开始登录 platform=${platform} profile=${profile} headless=${headless}`);

  const context = await chromium.launchPersistentContext(persistentProfileDir(settings.chromeProfilesDir, platform, profile), {
    headless,
    channel: "chrome",
    viewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
    ...(fs.existsSync(statePath) ? { storageState: statePath } : {}),
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(timeoutMs);

  let result: LoginResult;
  try {
    result = await login({
      page,
      context,
      account,
      artifacts,
      target: { platform, profile },
      options: { headless, slowMoMs: 0, timeoutMs, mode: "post" },
      settings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result = { status: "failed", platform, profile, error: msg, artifacts };
    logger.error(msg);
  } finally {
    try {
      await context.storageState({ path: statePath });
      logger.info(`登录态已保存: ${statePath}`);
    } catch {}
    await context.close().catch(() => {});
  }

  saveResult(artifacts.resultPath, result as any);
  return result;
}

