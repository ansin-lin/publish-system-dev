import path from "node:path";
import type { Page } from "playwright";

import type { PublishContext, PublishResult, RunOptions } from "../../src/shared/types.js";
import { humanStepWait } from "../shared/humanDelay.js";
import type { FacebookWriteLog } from "./publish.shared.js";
import {
  assertBody,
  assertLoggedIn,
  clickPost,
  createHumanWait,
  createWriteLog,
  dismissOverlays,
  finalizeFacebookPublish,
  gotoHome,
  waitForVisible,
} from "./publish.shared.js";

export type FacebookHomePublishOptions = {
  /** 首页 composer 按钮前缀名，如「王 艶艶」→ 「王 艶艶さん、その気持ち、シェアしよう」 */
  displayName?: string;
};

async function clickComposerTrigger(page: Page, writeLog: FacebookWriteLog, displayName?: string) {
  const byRoleCandidates: Array<() => ReturnType<Page["getByRole"]>> = [];

  if (displayName?.trim()) {
    const exact = `${displayName.trim()}さん、その気持ち、シェアしよう`;
    byRoleCandidates.push(() => page.getByRole("button", { name: exact, exact: true }));
    byRoleCandidates.push(() => page.getByRole("button", { name: new RegExp(`${displayName.trim()}さん、その気持ち`) }));
  }

  byRoleCandidates.push(
    () => page.getByRole("button", { name: /さん、その気持ち、シェアしよう/ }),
    () => page.getByRole("button", { name: /その気持ち、シェアしよう/ }),
    () => page.getByRole("button", { name: /さん、その気持ち/ }),
    () => page.getByRole("button", { name: /その気持ち/ }),
    () => page.getByRole("button", { name: /分享你的新鲜事吧/i }),
    () => page.getByRole("button", { name: /What's on your mind/i }),
    () => page.getByRole("button", { name: /你在想什么/i }),
  );

  for (let i = 0; i < byRoleCandidates.length; i += 1) {
    try {
      const loc = byRoleCandidates[i]!().first();
      await loc.waitFor({ state: "visible", timeout: 20_000 });
      await loc.click({ timeout: 20_000 });
      writeLog(`[home] clicked composer trigger index=${i}`);
      return;
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
  writeLog(`[home] clicked composer trigger selector=${selector}`);
}

/** 新首页 composer 为 feed 内联，不用 role=dialog；与 codegen 一致用 page 级 locator */
async function waitComposerTextbox(page: Page, writeLog: FacebookWriteLog) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const boxes = page.getByRole("textbox");
    const count = await boxes.count();
    for (let i = count - 1; i >= 0; i -= 1) {
      const tb = boxes.nth(i);
      try {
        if (await tb.isVisible()) {
          writeLog(`[home] composer textbox index=${i}`);
          return tb;
        }
      } catch {
        // try next
      }
    }
    await humanStepWait(page, writeLog, "wait_composer_textbox", 200, 500);
  }
  throw new Error("[home] 打开 composer 后未找到可见 textbox");
}

/** 严格对齐 codegen：paragraph → textbox.fill，不做 Ctrl+A 清空、不 scoped 到 dialog */
async function fillPostTextHome(page: Page, body: string, writeLog: FacebookWriteLog) {
  const textbox = await waitComposerTextbox(page, writeLog);

  try {
    const paragraph = page.getByRole("paragraph").first();
    if ((await paragraph.count()) > 0 && (await paragraph.isVisible().catch(() => false))) {
      await paragraph.click({ timeout: 10_000 });
      writeLog("[home] clicked paragraph");
    }
  } catch (e) {
    writeLog(`[home] paragraph click skipped: ${String(e)}`);
  }

  await textbox.click({ timeout: 10_000 });
  await textbox.fill(body);
  writeLog(`[home] filled textbox len=${body.length}`);
  await humanStepWait(page, writeLog, "after_fill", 500, 1000);
}

async function uploadMediaHome(
  page: Page,
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

  const uploadBtn = page.getByRole("button", { name: "写真または動画を追加 またはドラッグ＆ドロップ" }).first();
  await uploadBtn.waitFor({ state: "visible", timeout: 30_000 });

  // codegen 可 setInputFiles，但运行时多为 div[role=button]，须走 filechooser
  try {
    await uploadBtn.setInputFiles(toUpload, { timeout: 3000 });
    writeLog(`[home] uploaded via setInputFiles on button count=${toUpload.length}`);
  } catch (e) {
    writeLog(`[home] setInputFiles on button failed, trying filechooser: ${String(e)}`);
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 15_000 });
    await uploadBtn.click({ timeout: 20_000 });
    const chooser = await chooserPromise;
    await chooser.setFiles(toUpload);
    writeLog(`[home] uploaded via filechooser count=${toUpload.length}`);
  }

  await humanStepWait(page, writeLog, "after_upload", 2000, 4000);
}

async function setPrivacyToPublicHome(page: Page, writeLog: FacebookWriteLog) {
  const scopeBtn = page.getByRole("button", { name: /投稿の共有範囲/ }).first();
  await scopeBtn.waitFor({ state: "visible", timeout: 30_000 });
  await scopeBtn.click({ timeout: 20_000 });
  writeLog("[home] clicked 投稿の共有範囲");

  const publicText = page.getByText("公開", { exact: true }).first();
  await publicText.waitFor({ state: "visible", timeout: 20_000 });
  await publicText.click({ timeout: 20_000 });
  writeLog("[home] clicked 公開");

  const doneBtn = page
    .getByRole("button", { name: "プライバシー設定の共有範囲の選択を完了して、ダイアログを閉じる" })
    .first();
  await doneBtn.waitFor({ state: "visible", timeout: 20_000 });
  await doneBtn.click({ timeout: 20_000 });
  writeLog("[home] clicked privacy done");
  await humanStepWait(page, writeLog, "after_privacy", 500, 1000);
}

export async function publishFromHome(
  ctx: PublishContext,
  options: FacebookHomePublishOptions = {},
): Promise<PublishResult> {
  const { page } = ctx;
  const writeLog = createWriteLog(ctx.artifacts.logPath);
  const humanWait = createHumanWait(page, writeLog);
  const dismiss = () => dismissOverlays(page, writeLog, humanWait);

  writeLog(`[home] facebook publish entry=home_feed displayName=${JSON.stringify(options.displayName ?? "")}`);

  await gotoHome(page, humanWait, dismiss);
  const auth = await assertLoggedIn(ctx, writeLog);
  if (auth) return auth;

  const body = assertBody(ctx);

  await clickComposerTrigger(page, writeLog, options.displayName);
  await fillPostTextHome(page, body, writeLog);
  await uploadMediaHome(page, ctx.assets.mediaFiles, ctx.options, writeLog);
  await setPrivacyToPublicHome(page, writeLog);
  // 勿在发帖中途 dismissOverlays（会点到「閉じる」触发退出确认）
  await clickPost(page, page.locator("body"), writeLog, { clickWizardNextFirst: false, waitForEnabled: true });

  return finalizeFacebookPublish(ctx, writeLog);
}
