import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { missingPostUrlResult } from "../../src/shared/missingPostUrl.js";
import { nowIso } from "../../src/shared/time.js";
import { humanStepWait, humanWaitAfterPublishClick, POST_PUBLISH_SETTLE_MS, withHumanPacing } from "../shared/humanDelay.js";

function extLower(p: string): string {
  const idx = p.lastIndexOf(".");
  return idx >= 0 ? p.slice(idx).toLowerCase() : "";
}

async function waitForVisibleAny(page: Page, selectors: string[], timeoutMs: number): Promise<{ locator: Locator; selector: string }> {
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

export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const { page, context, assets, artifacts, target, job, options: runOpts } = ctx;
  const requirePostUrl = runOpts.requirePostUrl ?? true;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const isLoggedIn = async (): Promise<boolean> => {
    try {
      const url = page.url();
      if (url.includes("/accounts/login")) return false;
      // cookie 兜底：很多情况下有效 session 会有 sessionid
      try {
        const cookies = await context.cookies("https://www.instagram.com/");
        if (cookies.some((c) => c.name === "sessionid" && String(c.value ?? "").trim())) return true;
      } catch {
        // ignore
      }
      const selectors = [
        "a[href='/']",
        "svg[aria-label='Home']",
        "svg[aria-label='主页']",
        "svg[aria-label='ホーム']",
        "a[href*='/accounts/edit']",
      ];
      for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const gotoHome = async () => {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);
  };

  const dismissNotificationsDialogIfPresent = async () => {
    // 进入首页常见弹窗：Turn on notifications / お知らせをオンにする
    const notNowSelectors = [
      "button:has-text('Not Now')",
      "button:has-text('Not now')",
      "button:has-text('後で')",
      "button:has-text('以后再说')",
      "button:has-text('稍后')",
      "div[role='dialog'] button:has-text('Not Now')",
      "div[role='dialog'] button:has-text('後で')",
    ];
    for (const sel of notNowSelectors) {
      try {
        const btn = page.locator(sel).first();
        if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
          await btn.click({ timeout: 2000, force: true });
          writeLog(`dismiss notifications dialog selector=${sel}`);
          await page.waitForTimeout(600);
          return;
        }
      } catch {
        // try next
      }
    }

    // 兜底：如果有对话框但找不到上述按钮，尝试点最后一个 dialog button（通常是“后で/Not Now”）
    try {
      const dialog = page.locator("div[role='dialog']").first();
      if ((await dialog.count()) > 0 && (await dialog.isVisible().catch(() => false))) {
        const buttons = dialog.locator("button");
        const n = await buttons.count();
        if (n > 0) {
          await buttons.nth(n - 1).click({ timeout: 2000, force: true });
          writeLog("dismiss notifications dialog fallback=last_button");
          await page.waitForTimeout(600);
        }
      }
    } catch {
      // ignore
    }
  };

  const stepWait = async (label?: string) => humanStepWait(page, writeLog, label);

  const expandLeftSidebar = async () => {
    // 主页左侧侧边栏有时需要“鼠标移入”才会展开，出现更大的按钮/文案（对齐你的观察）
    // 兜底策略：优先 hover 到 nav；不行就把鼠标移到左侧栏区域
    try {
      const nav = page.locator("nav").first();
      if ((await nav.count()) > 0) {
        await nav.hover({ timeout: 2000 }).catch(() => {});
        writeLog("hovered nav to expand sidebar");
        await humanStepWait(page, writeLog, "sidebar_hover", 800, 1500);
        return;
      }
    } catch {
      // ignore
    }
    try {
      await page.mouse.move(20, 200);
      writeLog("moved mouse to left sidebar area");
      await humanStepWait(page, writeLog, "sidebar_move", 800, 1500);
    } catch {
      // ignore
    }
  };

  const clickCreateEntry = async () => {
    // 有些情况下左侧栏需要 hover 才会从 icon-only 展开出“新しい投稿 作成”可点击项
    const deadline = Date.now() + 45_000;
    let lastState = "";
    while (Date.now() < deadline) {
      await dismissNotificationsDialogIfPresent();
      await expandLeftSidebar();

      const createLink = page.getByRole("link", { name: "新しい投稿 作成" }).first();
      try {
        if ((await createLink.count()) > 0 && (await createLink.isVisible().catch(() => false))) {
          await createLink.click({ timeout: 10_000 });
          writeLog("clicked link 新しい投稿 作成");
          return;
        }
      } catch {
        // continue
      }

      // 兜底：尝试点“+ / New post”图标（即使未展开也可能存在）
      const iconSelectors = [
        "svg[aria-label='New post']",
        "svg[aria-label='作成']",
        "svg[aria-label='Create']",
        "svg[aria-label='新しい投稿']",
      ];
      for (const sel of iconSelectors) {
        try {
          const icon = page.locator(sel).first();
          if ((await icon.count()) > 0 && (await icon.isVisible().catch(() => false))) {
            await icon.click({ timeout: 10_000, force: true });
            writeLog(`clicked create icon selector=${sel}`);
            return;
          }
        } catch {
          // try next
        }
      }

      // 再兜底：鼠标更靠左、更靠上/下扫一遍，触发展开
      try {
        await page.mouse.move(5, 120);
        await humanStepWait(page, writeLog, "sidebar_sweep", 400, 800);
        await page.mouse.move(5, 420);
        await humanStepWait(page, writeLog, "sidebar_sweep", 400, 800);
        await page.mouse.move(35, 220);
        await humanStepWait(page, writeLog, "sidebar_sweep", 400, 800);
        lastState = `mouse_sweep url=${page.url()}`;
      } catch {
        lastState = `mouse_sweep_failed url=${page.url()}`;
      }
    }
    throw new Error(`找不到“新しい投稿 作成”入口（侧边栏未展开或 UI 变化）。${lastState}`);
  };

  await gotoHome();
  await dismissNotificationsDialogIfPresent();
  await expandLeftSidebar();
  if (!(await isLoggedIn())) {
    const reason = "Instagram 登录态失效（发布阶段不做登录，请先执行 npm run login -- --platform instagram）";
    writeLog(reason);
    return {
      status: "auth_expired",
      platform: "instagram",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason,
      artifacts,
    };
  }

  const body = assets.caption.trim();
  if (!body) {
    throw new Error("正文为空：Instagram 至少需要文案（当前实现不支持空文案发布）");
  }

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);

  const images = assets.mediaFiles.filter((p) => imageExts.has(extLower(p)));
  const videos = assets.mediaFiles.filter((p) => videoExts.has(extLower(p)));

  const isVideo = runOpts.mode === "video";
  const toUpload = isVideo ? videos.slice(0, 1) : images.slice(0, 1);
  if (toUpload.length === 0) {
    throw new Error(isVideo ? "video 模式需要 1 个本机视频文件" : "post 模式需要至少 1 张图片");
  }

  // 1) 对齐 codegen（日文 UI）：新しい投稿 作成 -> 投稿 投稿
  await dismissNotificationsDialogIfPresent();
  await expandLeftSidebar();
  await stepWait("before_create_entry");
  await clickCreateEntry();
  await stepWait("after_create_entry");
  await page.getByRole("link", { name: "投稿 投稿" }).click({ timeout: 60_000 });
  writeLog("clicked link 投稿 投稿");
  await stepWait("after_post_type_link");

  // 2) 对齐 codegen：コンピューターから選択 setInputFiles
  const selectBtn = page.getByRole("button", { name: "コンピューターから選択" }).first();
  await selectBtn.waitFor({ state: "visible", timeout: 60_000 });
  await withHumanPacing(
    page,
    "upload_media",
    async () => {
      try {
        await selectBtn.setInputFiles(toUpload, { timeout: 120_000 });
        writeLog(`uploaded via select button setInputFiles count=${toUpload.length}`);
      } catch (e) {
        writeLog(`select button setInputFiles failed, fallback to filechooser: ${String(e)}`);
        const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
        await selectBtn.click({ timeout: 30_000, force: true });
        const chooser = await chooserPromise;
        if (!chooser) throw e;
        await chooser.setFiles(toUpload);
        writeLog(`uploaded via filechooser count=${toUpload.length}`);
      }
    },
    writeLog,
  );

  // 视频上传会弹一个 OK（对齐 codegen）
  if (isVideo) {
    try {
      const okBtn = page.getByRole("button", { name: "OK" }).first();
      if ((await okBtn.count()) > 0 && (await okBtn.isVisible().catch(() => false))) {
        await okBtn.click({ timeout: 10_000 });
        writeLog("clicked OK after video upload");
      }
    } catch {
      // ignore
    }
  }

  // 3) 两次 次へ
  const nextBtn = page.getByRole("button", { name: "次へ" }).first();
  await nextBtn.waitFor({ state: "visible", timeout: 60_000 });
  await nextBtn.click({ timeout: 60_000 });
  writeLog("clicked 次へ (1)");
  await stepWait("after_next_1");
  await nextBtn.waitFor({ state: "visible", timeout: 60_000 });
  await nextBtn.click({ timeout: 60_000 });
  writeLog("clicked 次へ (2)");
  await stepWait("after_next_2");

  // 4) キャプションを入力…
  const captionBox = page.getByRole("textbox", { name: "キャプションを入力…" }).first();
  await captionBox.waitFor({ state: "visible", timeout: 60_000 });
  await withHumanPacing(
    page,
    "fill_caption",
    async () => {
      await captionBox.click({ timeout: 30_000 });
      await captionBox.fill(body);
      writeLog("filled caption キャプションを入力…");
    },
    writeLog,
  );

  // 5) シェア
  const shareBtn = page.getByRole("button", { name: "シェア", exact: true }).first();
  await shareBtn.waitFor({ state: "visible", timeout: 60_000 });
  await withHumanPacing(
    page,
    "click_publish",
    async () => {
      await shareBtn.click({ timeout: 60_000 });
      writeLog("clicked シェア");
    },
    writeLog,
  );
  await humanWaitAfterPublishClick(page, writeLog, runOpts.afterPublishClickMs ?? POST_PUBLISH_SETTLE_MS);

  // 6) 等待上传完成（视频额外多等）
  if (isVideo) await page.waitForTimeout(10_000);

  // 7) 完了
  const doneBtn = page.getByRole("button", { name: "完了" }).first();
  await doneBtn.waitFor({ state: "visible", timeout: 120_000 });
  await doneBtn.click({ timeout: 60_000 });
  writeLog("clicked 完了");

  const tryExtractPostUrl = async (): Promise<string | null> => {
    const selectors = ["a[href*='/p/']", "a[href*='/reel/']"];
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        writeLog(`post_url extract retry ${attempt}`);
        await page.waitForTimeout(3000);
      }
      for (const sel of selectors) {
        try {
          const link = page.locator(sel).first();
          if ((await link.count()) === 0) continue;
          const href = await link.getAttribute("href");
          if (href) return href.startsWith("http") ? href : `https://www.instagram.com${href}`;
        } catch {
          // try next
        }
      }
    }
    return null;
  };

  const postUrl = await tryExtractPostUrl();
  writeLog(`instagram post_url=${postUrl ?? "unknown"}`);

  if (!postUrl) {
    return missingPostUrlResult({
      requirePostUrl,
      platform: "instagram",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      artifacts,
      platformLabel: "Instagram",
    });
  }

  return {
    status: "published",
    platform: "instagram",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    published_at: nowIso(),
    post_url: postUrl,
    artifacts,
  };
}

