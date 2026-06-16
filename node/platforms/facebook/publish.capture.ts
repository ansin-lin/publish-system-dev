import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";

import type { PublishContext } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";
import { humanStepWait, withHumanPacing } from "../shared/humanDelay.js";

/**
 * Facebook 发布 — Playwright 捕获/录制用（勿被 runner 引用）。
 * 打开已登录首页，可选预填文案+图片，然后 page.pause() 供 Inspector 录制新 UI 选择器。
 */
const HOME_URL = "https://www.facebook.com/";

export type FacebookCaptureStep = "home" | "composer" | "filled" | "uploaded" | "ready";

export type FacebookCaptureOptions = {
  /** 预填停在哪一步；ready = 文案+图片+隐私，停在点「投稿」前 */
  step?: FacebookCaptureStep;
  /** 上传图片张数上限（默认 job 内全部） */
  maxImages?: number;
  /** home | profile */
  entry?: "home" | "profile";
  profileLinkName?: string;
};

function writeLog(artifactsLogPath: string, message: string) {
  const line = `[${nowIso()}] ${message}\n`;
  fs.mkdirSync(path.dirname(artifactsLogPath), { recursive: true });
  fs.appendFileSync(artifactsLogPath, line, "utf-8");
}

async function dismissOverlays(page: Page, log: (m: string) => void) {
  const selectors = [
    "button:has-text('すべて許可')",
    "button:has-text('同意所有')",
    "button:has-text('Allow all cookies')",
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "div[role='button'][aria-label='閉じる']",
    "div[role='button'][aria-label='关闭']",
    "div[aria-label='Close']",
    "div[role='button'][aria-label='Close']",
  ];
  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        log(`dismiss overlay: ${selector}`);
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
    if (url.includes("/login") || url.includes("checkpoint")) return false;
    const checks = [
      "a[aria-label='ホーム']",
      "a[aria-label='主页']",
      "a[aria-label='Home']",
      "div[role='feed']",
      "div[aria-label='账户']",
      "div[aria-label='Account']",
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

async function waitForVisible(page: Page, selectors: string[], timeoutMs: number) {
  let lastError: unknown;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return { locator, selector };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`No visible selector matched: ${JSON.stringify(selectors)}; last_error=${String(lastError)}`);
}

async function pickComposerDialog(page: Page, log: (m: string) => void): Promise<Locator> {
  const deadline = Date.now() + 30_000;
  let lastSeen = "";
  while (Date.now() < deadline) {
    const dialogs = page.locator("div[role='dialog']");
    const count = Math.min(await dialogs.count(), 6);
    for (let i = 0; i < count; i += 1) {
      const d = dialogs.nth(i);
      try {
        if (!(await d.isVisible())) continue;
        const tb = d.getByRole("textbox").first();
        if ((await tb.count()) > 0 && (await tb.isVisible().catch(() => false))) {
          return d;
        }
        const aria = (await d.getAttribute("aria-label").catch(() => null)) ?? "";
        if (aria && aria !== lastSeen) lastSeen = aria;
      } catch {
        continue;
      }
    }
    await humanStepWait(page, log, "wait_composer_dialog", 200, 500);
  }
  throw new Error(`找不到 Facebook 发帖对话框。last_seen_dialog_aria_label=${JSON.stringify(lastSeen)}`);
}

async function navigateToProfile(page: Page, log: (m: string) => void, profileLinkName?: string) {
  if (profileLinkName?.trim()) {
    const link = page.getByRole("link", { name: profileLinkName.trim(), exact: true }).first();
    await link.waitFor({ state: "visible", timeout: 30_000 });
    await link.click({ timeout: 30_000 });
    log(`[profile] clicked profile link name=${JSON.stringify(profileLinkName.trim())}`);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return;
  }
  log("[profile] profile_link_name not set, fallback goto /me");
  await page.goto("https://www.facebook.com/me", { waitUntil: "domcontentloaded", timeout: 60_000 });
}

async function openComposer(page: Page, log: (m: string) => void, entry: "home" | "profile"): Promise<Locator> {
  if (entry === "profile") {
    const profileBtn = page.getByRole("button", { name: "その気持ち、シェアしよう", exact: true }).first();
    try {
      await profileBtn.waitFor({ state: "visible", timeout: 20_000 });
      await profileBtn.click({ timeout: 20_000 });
      log("[profile] open composer trigger=その気持ち、シェアしよう");
      return pickComposerDialog(page, log);
    } catch {
      // fall through to home triggers
    }
  }

  const byRoleCandidates = [
    () => page.getByRole("button", { name: /その気持ち、シェアしよう/ }).first(),
    () => page.getByRole("button", { name: /さん、その気持ち/ }).first(),
    () => page.getByRole("button", { name: /その気持ち/ }).first(),
    () => page.getByRole("button", { name: /分享你的新鲜事吧/i }).first(),
    () => page.getByRole("button", { name: /What's on your mind/i }).first(),
    () => page.getByRole("button", { name: /你在想什么/i }).first(),
  ];

  for (let i = 0; i < byRoleCandidates.length; i += 1) {
    try {
      const loc = byRoleCandidates[i]!();
      await loc.waitFor({ state: "visible", timeout: 20_000 });
      await loc.click({ timeout: 20_000 });
      log(`open composer trigger=role_button index=${i}`);
      return await pickComposerDialog(page, log);
    } catch {
      // try next
    }
  }

  const triggers = [
    "div[role='button']:has-text('その気持ち')",
    "span:has-text('その気持ち')",
    "div[role='button']:has-text('分享你的新鲜事')",
    "div[role='button']:has-text('你在想什么')",
    "span:has-text('你在想什么')",
    "div[role='button']:has-text(\"What's on your mind\")",
    "span:has-text(\"What's on your mind\")",
  ];
  const { locator, selector } = await waitForVisible(page, triggers, 30_000);
  await locator.click({ timeout: 30_000 });
  log(`open composer trigger=${selector}`);
  return pickComposerDialog(page, log);
}

async function fillPostText(page: Page, dialog: Locator, body: string, log: (m: string) => void) {
  await withHumanPacing(
    page,
    "fill_post_text",
    async () => {
      const roleTextbox = dialog.getByRole("textbox").first();
      await roleTextbox.waitFor({ state: "visible", timeout: 20_000 });
      await roleTextbox.click({ timeout: 10_000, force: true });
      await roleTextbox.fill(body);
      const preview = ((await roleTextbox.innerText().catch(() => "")) ?? "").trim();
      const probe = body.trim().slice(0, 20);
      if (probe && !preview.includes(probe)) {
        throw new Error("role textbox verification failed");
      }
      log(`composer text verified probe=${JSON.stringify(probe)}`);
    },
    log,
  );
}

async function clickMediaWizardNext(page: Page, log: (m: string) => void) {
  const nextCandidates = [
    () => page.getByRole("button", { name: "次へ", exact: true }).first(),
    () => page.getByRole("button", { name: "继续", exact: true }).first(),
    () => page.getByRole("button", { name: "Continue", exact: true }).first(),
    () => page.getByRole("button", { name: "Next", exact: true }).first(),
  ];
  for (let i = 0; i < nextCandidates.length; i += 1) {
    try {
      const btn = nextCandidates[i]!();
      if ((await btn.count()) === 0 || !(await btn.isVisible().catch(() => false))) continue;
      await btn.click({ timeout: 30_000 });
      log(`clicked media wizard next index=${i}`);
      await humanStepWait(page, log, "after_media_next", 500, 1200);
      return;
    } catch {
      // try next
    }
  }
}

async function uploadMedia(page: Page, dialog: Locator, files: string[], log: (m: string) => void) {
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const images = files.filter((p) => imageExts.has(path.extname(p).toLowerCase()));
  if (images.length === 0) {
    log("no images to upload");
    return;
  }

  await withHumanPacing(
    page,
    "upload_media",
    async () => {
      const photoBtn = dialog.getByRole("button", { name: "写真・動画" }).first();
      try {
        await photoBtn.waitFor({ state: "visible", timeout: 20_000 });
        await photoBtn.setInputFiles(images, { timeout: 120_000 });
        log(`uploaded via 写真・動画 count=${images.length}`);
        await clickMediaWizardNext(page, log);
        return;
      } catch (e) {
        log(`写真・動画 path failed: ${String(e)}`);
      }

      const btn = dialog.getByRole("button", { name: /照片\/视频|Photo\/video/i }).first();
      try {
        await btn.waitFor({ state: "visible", timeout: 20_000 });
        await btn.setInputFiles(images, { timeout: 120_000 });
        log(`uploaded via 照片/视频 count=${images.length}`);
        await clickMediaWizardNext(page, log);
        return;
      } catch (e) {
        log(`照片/视频 path failed: ${String(e)}`);
      }

      const input = dialog.locator("input[type='file']").first();
      if ((await input.count()) > 0) {
        await input.setInputFiles(images, { timeout: 120_000 });
        log(`uploaded via input[type=file] count=${images.length}`);
        await clickMediaWizardNext(page, log);
        return;
      }

      throw new Error("未能上传媒体（capture：请手动上传后在 Inspector 中录制）");
    },
    log,
  );
}

async function setPrivacyToPublic(page: Page, log: (m: string) => void) {
  const scopeBtn = page.getByRole("button", { name: /投稿の共有範囲/ }).first();
  if ((await scopeBtn.count()) === 0 || !(await scopeBtn.isVisible().catch(() => false))) {
    log("privacy scope button not found; skip");
    return;
  }
  await scopeBtn.click({ timeout: 20_000 });
  const publicRadio = page.getByRole("radio", { name: /Facebook利用者以外を含むすべての人/ }).first();
  await publicRadio.check({ timeout: 20_000 });
  const doneBtn = page
    .getByRole("button", { name: "プライバシー設定の共有範囲の選択を完了して、ダイアログを閉じる" })
    .first();
  await doneBtn.click({ timeout: 20_000 });
  log("privacy set to public");
}

/** 把当前页面上可见 dialog / 按钮信息写入日志，便于对照新 UI */
export async function dumpCaptureHints(page: Page, log: (m: string) => void) {
  log(`capture_hints url=${page.url()}`);
  const dialogs = page.locator("div[role='dialog']");
  const dialogCount = Math.min(await dialogs.count(), 8);
  log(`capture_hints visible_dialogs=${dialogCount}`);
  for (let i = 0; i < dialogCount; i += 1) {
    const d = dialogs.nth(i);
    if (!(await d.isVisible().catch(() => false))) continue;
    const aria = (await d.getAttribute("aria-label").catch(() => "")) ?? "";
    log(`  dialog[${i}] aria-label=${JSON.stringify(aria)}`);
    const buttons = d.locator("button, div[role='button']");
    const bc = Math.min(await buttons.count(), 40);
    for (let j = 0; j < bc; j += 1) {
      const b = buttons.nth(j);
      if (!(await b.isVisible().catch(() => false))) continue;
      const text = ((await b.innerText().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
      const ariaLabel = (await b.getAttribute("aria-label").catch(() => "")) ?? "";
      const disabled = (await b.getAttribute("aria-disabled").catch(() => "")) ?? "";
      if (text || ariaLabel) {
        log(`    btn text=${JSON.stringify(text)} aria-label=${JSON.stringify(ariaLabel)} aria-disabled=${disabled}`);
      }
    }
  }

  const composerTriggers = [
    "その気持ち",
    "What's on your mind",
    "你在想什么",
    "分享你的新鲜事",
  ];
  for (const t of composerTriggers) {
    const loc = page.locator(`div[role='button']:has-text('${t}'), span:has-text('${t}')`).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      log(`  composer_trigger visible text=${JSON.stringify(t)}`);
    }
  }
}

export async function saveCaptureSnapshot(page: Page, runDir: string, log: (m: string) => void) {
  fs.mkdirSync(runDir, { recursive: true });
  const htmlPath = path.join(runDir, "capture-page.html");
  const pngPath = path.join(runDir, "capture-page.png");
  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf-8");
    log(`snapshot html=${htmlPath}`);
  } catch (e) {
    log(`snapshot html failed: ${String(e)}`);
  }
  try {
    await page.screenshot({ path: pngPath, fullPage: true });
    log(`snapshot png=${pngPath}`);
  } catch (e) {
    log(`snapshot png failed: ${String(e)}`);
  }
}

async function runPrepareStep(
  page: Page,
  ctx: PublishContext,
  step: FacebookCaptureStep,
  maxImages: number,
  log: (m: string) => void,
  entry: "home" | "profile",
  profileLinkName?: string,
): Promise<Locator | null> {
  let dialog: Locator | null = null;

  if (step === "home") return null;

  if (entry === "profile") {
    await navigateToProfile(page, log, profileLinkName);
  }

  try {
    dialog = await openComposer(page, log, entry);
  } catch (e) {
    log(`WARN openComposer failed: ${String(e)}`);
    return null;
  }
  if (step === "composer") return dialog;

  const body = ctx.assets.caption.trim();
  if (!body) throw new Error("prepare 需要 job 中有非空 facebook content.body");
  try {
    await fillPostText(page, dialog, body, log);
  } catch (e) {
    log(`WARN fillPostText failed: ${String(e)}`);
    if (step === "filled") return dialog;
  }
  if (step === "filled") return dialog;

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const images = ctx.assets.mediaFiles
    .filter((p) => imageExts.has(path.extname(p).toLowerCase()))
    .slice(0, Math.max(1, maxImages));
  try {
    await uploadMedia(page, dialog, images, log);
  } catch (e) {
    log(`WARN uploadMedia failed: ${String(e)}`);
    if (step === "uploaded") return dialog;
  }
  if (step === "uploaded") return dialog;

  try {
    await dismissOverlays(page, log);
    await setPrivacyToPublic(page, log);
    await clickMediaWizardNext(page, log);
  } catch (e) {
    log(`WARN privacy/next failed: ${String(e)}`);
  }

  return dialog;
}

/**
 * 打开 Facebook 首页并暂停，供 Playwright Inspector / codegen 捕获新发布流程。
 */
export async function capturePublish(ctx: PublishContext, options: FacebookCaptureOptions = {}): Promise<void> {
  const { page, artifacts, assets } = ctx;
  const log = (m: string) => writeLog(artifacts.logPath, m);
  const step: FacebookCaptureStep = options.step ?? "home";
  const maxImages = options.maxImages ?? assets.mediaFiles.length;
  const entry = options.entry ?? "home";
  const profileLinkName = options.profileLinkName;

  log(`capture start step=${step} entry=${entry} caption_len=${assets.caption.length} images=${assets.mediaFiles.length} maxImages=${maxImages}`);

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await dismissOverlays(page, log);

  if (!(await isLoggedIn(page))) {
    throw new Error("Facebook 未登录。请先执行: npm run login -- --platform facebook --profile default");
  }

  if (step !== "home") {
    await runPrepareStep(page, ctx, step, maxImages, log, entry, profileLinkName);
  } else if (entry === "profile") {
    await navigateToProfile(page, log, profileLinkName);
    log("step=home entry=profile：已在个人主页，请手动打开发帖框再录制");
  } else {
    log("step=home entry=home：仅打开首页，请手动点开发帖框再录制");
  }

  await dumpCaptureHints(page, log);
  await saveCaptureSnapshot(page, artifacts.runDir, log);

  log("page.pause() — Playwright Inspector 已打开；Resume 继续操作，或从 Record 面板复制新选择器到 platforms/facebook/publish.ts");
  await page.pause();
}
