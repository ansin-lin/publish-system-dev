import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";

import type { PublishContext } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

/**
 * X 发布 — Playwright 捕获/录制用（勿被 runner 引用）。
 * 打开已登录首页，可选预填文案+图片，然后 page.pause() 供 Inspector 录制选择器。
 */
const HOME_URL = "https://x.com/home";

export type XCaptureOptions = {
  /** 从 job 预填文案与图片，停在点击 Post 之前 */
  prepare?: boolean;
};

function writeLog(artifactsLogPath: string, message: string) {
  const line = `[${nowIso()}] ${message}\n`;
  fs.mkdirSync(path.dirname(artifactsLogPath), { recursive: true });
  fs.appendFileSync(artifactsLogPath, line, "utf-8");
}

async function dismissOverlays(page: Page, log: (m: string) => void) {
  const selectors = [
    "button:has-text('Got it')",
    "button:has-text('Accept all cookies')",
    "button:has-text('Accept all')",
    "button:has-text('Close')",
    "button:has-text('Not now')",
    "button:has-text('Cancel')",
    "div[role='button'][aria-label='Close']",
  ];
  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        log(`关闭遮罩: ${selector}`);
        await loc.click({ timeout: 1500, force: true });
      }
    } catch {
      // ignore
    }
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes("login") || url.includes("/i/flow/")) return false;
    const checks = [
      "div[aria-label='Timeline: Your Home Timeline']",
      "a[href='/home']",
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

async function findHomeComposer(page: Page): Promise<Locator> {
  const primary = page.locator("div[data-testid='primaryColumn']").first();
  await primary.waitFor({ timeout: 30_000 });

  const editor = primary
    .locator("div[contenteditable='true'][data-testid='tweetTextarea_0'][role='textbox']:visible")
    .first();
  await editor.waitFor({ timeout: 30_000 });

  const candidates = editor.locator(
    "xpath=ancestor::div[.//button[@data-testid='tweetButtonInline']][position() <= 12]",
  );
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    try {
      const buttons = candidate.locator("button[data-testid='tweetButtonInline']:visible");
      const sameEditors = candidate.locator(
        "div[contenteditable='true'][data-testid='tweetTextarea_0'][role='textbox']:visible",
      );
      const toolNodes = candidate.locator(
        "input[data-testid='fileInput'], [data-testid='toolBar'], [aria-label='Add photos or video']",
      );
      if ((await buttons.count()) === 1 && (await sameEditors.count()) === 1 && (await toolNodes.count()) > 0) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  const fallback = editor.locator("xpath=ancestor::div[.//button[@data-testid='tweetButtonInline']][1]").first();
  if ((await fallback.count()) > 0) return fallback;
  throw new Error("找不到 X 首页发帖编辑器容器（composer root）");
}

async function setEditorText(page: Page, editor: Locator, body: string) {
  const text = body.trim();
  await editor.scrollIntoViewIfNeeded();
  await editor.click({ timeout: 10_000, force: true });
  try {
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
  } catch {
    // ignore
  }
  if (text) await page.keyboard.type(text, { delay: 30 });
}

async function attachImages(composer: Locator, mediaFiles: string[], log: (m: string) => void) {
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const images = mediaFiles.filter((p) => imageExts.has(p.toLowerCase().slice(p.lastIndexOf("."))));
  if (images.length === 0) return;
  const picked = images.slice(0, 4);
  const fileInput = composer.locator("input[data-testid='fileInput'], input[type='file']").first();
  await fileInput.setInputFiles(picked);
  log(`已上传图片 ${picked.length} 张`);
}

async function prepareComposer(page: Page, ctx: PublishContext, log: (m: string) => void) {
  const body = ctx.assets.caption.trim();
  if (!body) throw new Error("prepare 需要 job 中有非空 content.body");

  const composer = await findHomeComposer(page);
  const editor = composer
    .locator("div[contenteditable='true'][data-testid='tweetTextarea_0'][role='textbox']:visible")
    .first();

  log("预填文案…");
  await setEditorText(page, editor, body);
  log("上传图片…");
  await attachImages(composer, ctx.assets.mediaFiles, log);
  log("已停在 Post 按钮前，请在 Inspector 中录制点击 Post / 校验流程");
}

/**
 * 打开 X 首页并暂停，供 Playwright Inspector 捕获选择器与操作序列。
 */
export async function capturePublish(ctx: PublishContext, options: XCaptureOptions = {}): Promise<void> {
  const { page, artifacts, assets } = ctx;
  const log = (m: string) => writeLog(artifacts.logPath, m);

  log(`capture 开始 prepare=${Boolean(options.prepare)} caption_len=${assets.caption.length} images=${assets.mediaFiles.length}`);

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await dismissOverlays(page, log);

  if (!(await isLoggedIn(page))) {
    throw new Error("X 未登录。请先执行: npm run login -- --platform x");
  }

  if (options.prepare) {
    await prepareComposer(page, ctx, log);
  } else {
    log("未 --prepare：仅打开首页 composer，请手动点进编辑区再录制");
  }

  log("page.pause() — Playwright Inspector 已打开；Resume 继续浏览，或复制 Record 面板中的定位器");
  await page.pause();
}
