import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";

import type { PublishContext, PublishResult, RunOptions } from "../../src/shared/types.js";
import { facebookUrlFailsValidation } from "../../src/shared/facebookPostUrl.js";
import { missingPostUrlResult } from "../../src/shared/missingPostUrl.js";
import { nowIso } from "../../src/shared/time.js";
import {
  humanStepWait,
  humanWaitAfterPublishClick,
  POST_PUBLISH_SETTLE_MS,
  withHumanPacing,
} from "../shared/humanDelay.js";

export type FacebookWriteLog = (message: string) => void;

export function createWriteLog(artifactsLogPath: string): FacebookWriteLog {
  return (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifactsLogPath), { recursive: true });
    fs.appendFileSync(artifactsLogPath, line, "utf-8");
  };
}

export async function dismissOverlays(page: Page, writeLog: FacebookWriteLog, humanWait: () => Promise<void>) {
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
        await humanWait();
        await loc.click({ timeout: 1500, force: true });
        writeLog(`dismiss overlay: ${selector}`);
        await humanWait();
      }
    } catch {
      // ignore
    }
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
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

export async function gotoHome(page: Page, humanWait: () => Promise<void>, dismiss: () => Promise<void>) {
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await humanWait();
  await dismiss();
}

export async function waitForVisible(page: Page, selectors: string[], timeoutMs: number) {
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

export async function pickComposerDialog(page: Page, writeLog: FacebookWriteLog): Promise<Locator> {
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
    await humanStepWait(page, writeLog, "wait_composer_dialog", 200, 500);
  }
  throw new Error(`找不到 Facebook 发帖对话框（包含 textbox 的 dialog）。last_seen_dialog_aria_label=${JSON.stringify(lastSeen)}`);
}

export async function fillPostText(
  page: Page,
  dialog: Locator,
  body: string,
  writeLog: FacebookWriteLog,
  humanWait: () => Promise<void>,
) {
  await withHumanPacing(
    page,
    "fill_post_text",
    async () => {
      try {
        const p = dialog.getByRole("paragraph").first();
        if ((await p.count()) > 0) {
          await p.click({ timeout: 5000, force: true });
          writeLog("composer paragraph clicked");
          await humanStepWait(page, writeLog, "composer_paragraph", 300, 800);
        }
      } catch {
        // ignore
      }

      const roleTextbox = dialog.getByRole("textbox").first();
      try {
        await roleTextbox.waitFor({ state: "visible", timeout: 20_000 });
        await roleTextbox.scrollIntoViewIfNeeded();
        await roleTextbox.click({ timeout: 10_000, force: true });
        await humanStepWait(page, writeLog, "textbox_focus", 200, 600);
        await roleTextbox.fill(body);
        await humanStepWait(page, writeLog, "textbox_filled", 300, 900);

        const preview = ((await roleTextbox.innerText().catch(() => "")) ?? "").trim();
        const probe = body.trim().slice(0, 20);
        if (probe && !preview.includes(probe)) {
          throw new Error("role textbox verification failed");
        }
        writeLog(`composer text verified via role textbox probe=${JSON.stringify(probe)}`);
        return;
      } catch (e) {
        writeLog(`role textbox fill failed, fallback to contenteditable path: ${String(e)}`);
      }

      const candidates = [
        dialog.locator("div[role='textbox'][contenteditable='true']").first(),
        dialog.locator("div[contenteditable='true'][role='textbox']").first(),
        dialog.locator("div[contenteditable='true']").first(),
        page.getByRole("textbox").first(),
      ];

      let editor: Locator | null = null;
      for (let i = 0; i < candidates.length; i += 1) {
        const loc = candidates[i]!;
        try {
          await loc.waitFor({ state: "visible", timeout: 15_000 });
          editor = loc;
          writeLog(`composer editor picked fallback index=${i}`);
          break;
        } catch {
          // try next
        }
      }
      if (!editor) throw new Error("找不到 Facebook 创建帖子编辑器（textbox/contenteditable）");

      await editor.scrollIntoViewIfNeeded();
      await editor.click({ timeout: 10_000, force: true });
      await humanWait();
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.press("Backspace").catch(() => {});
      await page.keyboard.type(body, { delay: 20 });
      await humanWait();

      const preview = ((await editor.innerText().catch(() => "")) ?? "").trim();
      const probe = body.trim().slice(0, 20);
      if (probe && !preview.includes(probe)) {
        throw new Error("Facebook 文案输入校验失败：编辑器内容未包含正文前 20 字（可能写入到错误区域）");
      }
      writeLog(`composer text verified probe=${JSON.stringify(probe)}`);
    },
    writeLog,
  );
}

export async function clickMediaWizardNext(page: Page, writeLog: FacebookWriteLog) {
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
      writeLog(`clicked media wizard next index=${i}`);
      await humanStepWait(page, writeLog, "after_media_next", 500, 1200);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export async function uploadMedia(
  page: Page,
  dialog: Locator,
  files: string[],
  runOpts: RunOptions,
  writeLog: FacebookWriteLog,
) {
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);
  const images = files.filter((p) => imageExts.has(path.extname(p).toLowerCase()));
  const videos = files.filter((p) => videoExts.has(path.extname(p).toLowerCase()));

  const toUpload = runOpts.mode === "video" ? videos.slice(0, 1) : images;
  if (toUpload.length === 0) return;

  await withHumanPacing(
    page,
    "upload_media",
    async () => {
      const photoBtn = dialog.getByRole("button", { name: "写真・動画" }).first();
      try {
        await photoBtn.waitFor({ state: "visible", timeout: 20_000 });
        writeLog("found 写真・動画");
        try {
          await photoBtn.setInputFiles(toUpload, { timeout: 120_000 });
          writeLog(`uploaded via 写真・動画 setInputFiles count=${toUpload.length}`);
        } catch (e) {
          writeLog(`写真・動画 setInputFiles failed, fallback to filechooser: ${String(e)}`);
          const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
          await photoBtn.click({ timeout: 20_000, force: true });
          const chooser = await chooserPromise;
          if (!chooser) throw e;
          await chooser.setFiles(toUpload);
          writeLog(`uploaded via filechooser count=${toUpload.length}`);
        }
        return;
      } catch (e) {
        writeLog(`写真・動画 upload path failed: ${String(e)}`);
      }

      try {
        const btn = dialog.getByRole("button", { name: /照片\/视频|Photo\/video/i }).first();
        await btn.waitFor({ state: "visible", timeout: 20_000 });
        writeLog("fallback add-photo button role=button name~=照片/视频");
        try {
          await btn.setInputFiles(toUpload, { timeout: 120_000 });
          writeLog(`uploaded via add-photo button setInputFiles count=${toUpload.length}`);
        } catch (e) {
          writeLog(`add-photo setInputFiles failed, filechooser: ${String(e)}`);
          const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
          await btn.click({ timeout: 10_000, force: true });
          const chooser = await chooserPromise;
          if (!chooser) throw e;
          await chooser.setFiles(toUpload);
          writeLog(`uploaded via filechooser count=${toUpload.length}`);
        }
        return;
      } catch (e) {
        writeLog(`add-photo button setInputFiles failed: ${String(e)}`);
      }

      const addPhotoButtons = [
        "div[role='button']:has-text('写真・動画')",
        "div[role='button']:has-text('写真')",
        "div[role='button']:has-text('照片/视频')",
        "div[role='button']:has-text('照片')",
        "div[role='button']:has-text('图片')",
        "div[role='button']:has-text('Photo/video')",
        "div[role='button']:has-text('Photo')",
        "div[role='button'][aria-label*='写真']",
        "div[role='button'][aria-label*='照片']",
        "div[role='button'][aria-label*='Photo']",
      ];

      for (const sel of addPhotoButtons) {
        try {
          const btn = dialog.locator(sel).first();
          if ((await btn.count()) === 0) continue;
          if (!(await btn.isVisible())) continue;

          const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
          await btn.click({ timeout: 10_000, force: true });
          writeLog(`clicked add-photo button selector=${sel}`);

          const chooser = await chooserPromise;
          if (chooser) {
            await chooser.setFiles(toUpload);
            writeLog(`uploaded via filechooser count=${toUpload.length}`);
            return;
          }
          break;
        } catch {
          // try next
        }
      }

      const inputs = ["input[type='file'][accept*='image']", "input[type='file']"];
      for (const sel of inputs) {
        try {
          const input = dialog.locator(sel).first();
          if ((await input.count()) === 0) continue;
          await input.setInputFiles(toUpload, { timeout: 120_000 });
          writeLog(`uploaded media selector=${sel} count=${toUpload.length}`);
          return;
        } catch {
          // try next
        }
      }

      throw new Error("未能上传媒体：未触发 filechooser 且找不到 input[type=file]");
    },
    writeLog,
  );
}

export async function setPrivacyToPublic(page: Page, writeLog: FacebookWriteLog) {
  await withHumanPacing(
    page,
    "set_privacy_public",
    async () => {
      const scopeBtn = page.getByRole("button", { name: /投稿の共有範囲/ }).first();
      if ((await scopeBtn.count()) === 0 || !(await scopeBtn.isVisible().catch(() => false))) {
        writeLog("privacy scope button not found; skip setPrivacyToPublic");
        return;
      }
      await scopeBtn.click({ timeout: 20_000 });
      writeLog("clicked 投稿の共有範囲");

      const publicRadio = page.getByRole("radio", { name: /Facebook利用者以外を含むすべての人/ }).first();
      await publicRadio.waitFor({ state: "visible", timeout: 20_000 });
      await publicRadio.check({ timeout: 20_000 });
      writeLog("checked 公開 Facebook利用者以外を含むすべての人");

      const publicText = page.getByText("Facebook利用者以外を含むすべての人").first();
      if ((await publicText.count()) > 0 && (await publicText.isVisible().catch(() => false))) {
        await publicText.click({ timeout: 10_000 });
        writeLog("clicked Facebook利用者以外を含むすべての人");
      }

      const doneBtn = page
        .getByRole("button", { name: "プライバシー設定の共有範囲の選択を完了して、ダイアログを閉じる" })
        .first();
      await doneBtn.waitFor({ state: "visible", timeout: 20_000 });
      await doneBtn.click({ timeout: 20_000 });
      writeLog("clicked privacy dialog done");
      await humanStepWait(page, writeLog, "after_privacy_done", 400, 900);
    },
    writeLog,
  );
}

export async function waitPostButtonEnabled(page: Page, dialog: Locator, writeLog: FacebookWriteLog, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = [
      page.getByRole("button", { name: "投稿", exact: true }).first(),
      dialog.getByRole("button", { name: "投稿", exact: true }).first(),
      page.getByRole("button", { name: "发布", exact: true }).first(),
      page.getByRole("button", { name: "Post", exact: true }).first(),
    ];
    for (const btn of candidates) {
      try {
        if ((await btn.count()) === 0 || !(await btn.isVisible().catch(() => false))) continue;
        const ariaDisabled = await btn.getAttribute("aria-disabled").catch(() => null);
        const disabledAttr = await btn.getAttribute("disabled").catch(() => null);
        if (ariaDisabled !== "true" && disabledAttr === null) {
          writeLog("post button enabled");
          return;
        }
        writeLog(`post button still disabled aria-disabled=${ariaDisabled}`);
      } catch {
        // try next
      }
    }
    await humanStepWait(page, writeLog, "wait_post_enabled", 800, 1500);
  }
  writeLog("WARN waitPostButtonEnabled timeout");
}

export type ClickPostOptions = {
  clickWizardNextFirst?: boolean;
  waitForEnabled?: boolean;
};

export async function clickPost(
  page: Page,
  dialog: Locator,
  writeLog: FacebookWriteLog,
  options: ClickPostOptions = {},
) {
  if (options.clickWizardNextFirst) {
    await clickMediaWizardNext(page, writeLog);
  }
  if (options.waitForEnabled) {
    await waitPostButtonEnabled(page, dialog, writeLog);
  }

  const roleCandidates = [
    () => page.getByRole("button", { name: "投稿", exact: true }).first(),
    () => dialog.getByRole("button", { name: "投稿", exact: true }).first(),
    () => page.getByRole("button", { name: "发布", exact: true }).first(),
    () => dialog.getByRole("button", { name: "发布", exact: true }).first(),
    () => page.getByRole("button", { name: "发帖", exact: true }).first(),
    () => dialog.getByRole("button", { name: "发帖", exact: true }).first(),
    () => page.getByRole("button", { name: "Post", exact: true }).first(),
    () => dialog.getByRole("button", { name: "Post", exact: true }).first(),
  ];
  for (let i = 0; i < roleCandidates.length; i += 1) {
    try {
      const btn = roleCandidates[i]!();
      await btn.waitFor({ state: "visible", timeout: 30_000 });
      await btn.scrollIntoViewIfNeeded();
      const ariaDisabled = await btn.getAttribute("aria-disabled").catch(() => null);
      if (ariaDisabled === "true") {
        writeLog(`post button disabled role index=${i}`);
        continue;
      }
      await withHumanPacing(
        page,
        "click_publish",
        async () => {
          await btn.click({ timeout: 30_000, force: true });
          writeLog(`clicked post role index=${i}`);
        },
        writeLog,
      );
      return;
    } catch {
      // try next
    }
  }

  const candidates = [
    "div[role='button']:has-text('投稿')",
    "button:has-text('投稿')",
    "div[role='button']:has-text('发布')",
    "button:has-text('发布')",
    "div[role='button']:has-text('发帖')",
    "button:has-text('发帖')",
    "div[role='button']:has-text('Post')",
    "button:has-text('Post')",
  ];

  for (const sel of candidates) {
    const btn = dialog.locator(sel).first();
    try {
      if ((await btn.count()) === 0) continue;
      await btn.waitFor({ state: "visible", timeout: 30_000 });
      await btn.scrollIntoViewIfNeeded();

      const ariaDisabled = await btn.getAttribute("aria-disabled").catch(() => null);
      const disabledAttr = await btn.getAttribute("disabled").catch(() => null);
      if (ariaDisabled === "true" || disabledAttr !== null) {
        writeLog(`post button disabled selector=${sel}`);
        continue;
      }

      await withHumanPacing(
        page,
        "click_publish",
        async () => {
          await btn.click({ timeout: 30_000, force: true });
          writeLog(`clicked post selector=${sel}`);
        },
        writeLog,
      );
      return;
    } catch {
      // try next
    }
  }
  throw new Error("找不到可点击的 Facebook 发帖/发布按钮（可能文案未写入或图片未加载完成）");
}

export async function tryExtractLatestPostUrl(page: Page, writeLog: FacebookWriteLog): Promise<string | null> {
  const selectors = [
    "a[href*='/posts/']",
    "a[href*='permalink.php']",
    "a[href*='pfbid']",
    "a[href*='/photo/?fbid=']",
    "a[href*='story_fbid=']",
  ];
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      writeLog(`post_url extract retry ${attempt}`);
      await page.waitForTimeout(3000);
      try {
        await page.mouse.wheel(0, 400);
      } catch {
        // ignore
      }
    }
    for (const sel of selectors) {
      try {
        const links = page.locator(sel).first();
        if ((await links.count()) === 0) continue;
        const href = await links.getAttribute("href");
        if (!href) continue;
        const url = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
        if (url.includes("/posts/") || url.includes("pfbid") || url.includes("permalink.php")) {
          return url;
        }
      } catch {
        // try next
      }
    }
  }
  return null;
}

export async function finalizeFacebookPublish(ctx: PublishContext, writeLog: FacebookWriteLog): Promise<PublishResult> {
  const { page, artifacts, target, job, options: runOpts } = ctx;
  const requirePostUrl = runOpts.requirePostUrl ?? true;
  const validationMode = runOpts.validationMode ?? "balanced";

  await humanWaitAfterPublishClick(page, writeLog, runOpts.afterPublishClickMs ?? POST_PUBLISH_SETTLE_MS);

  try {
    await page.locator("div[role='dialog']").first().waitFor({ state: "hidden", timeout: 60_000 });
  } catch {
    // ignore
  }

  const dismiss = () => dismissOverlays(page, writeLog, () => humanStepWait(page, writeLog));
  await gotoHome(page, () => humanStepWait(page, writeLog), dismiss);

  const postUrl = await tryExtractLatestPostUrl(page, writeLog);
  writeLog(`facebook published post_url=${postUrl ?? "unknown"}`);

  if (!postUrl) {
    return missingPostUrlResult({
      requirePostUrl,
      platform: "facebook",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      artifacts,
      platformLabel: "Facebook",
    });
  }
  const fbUrlErr = facebookUrlFailsValidation(postUrl, validationMode);
  if (fbUrlErr) {
    return {
      status: "failed",
      platform: "facebook",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      error: `Facebook 回执校验: ${fbUrlErr} (${postUrl})`,
      artifacts,
    };
  }

  return {
    status: "published",
    platform: "facebook",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    published_at: nowIso(),
    post_url: postUrl,
    artifacts,
  };
}

export async function assertLoggedIn(ctx: PublishContext, writeLog: FacebookWriteLog): Promise<PublishResult | null> {
  const { page, artifacts, target, job } = ctx;
  if (await isLoggedIn(page)) return null;
  const reason = "Facebook 登录态失效（发布阶段不做登录，请先执行 npm run login -- --platform facebook）";
  writeLog(reason);
  return {
    status: "auth_expired",
    platform: "facebook",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    reason,
    artifacts,
  };
}

export function assertBody(ctx: PublishContext): string {
  const body = ctx.assets.caption.trim();
  if (!body) {
    throw new Error("正文为空：Facebook 至少需要文案（请检查 payloads.facebook.content.body / default / legacy）");
  }
  return body;
}

export function createHumanWait(page: Page, writeLog: FacebookWriteLog) {
  return (label?: string) => humanStepWait(page, writeLog, label);
}
