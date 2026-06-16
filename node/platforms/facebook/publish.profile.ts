import type { Locator } from "playwright";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import {
  assertBody,
  assertLoggedIn,
  clickMediaWizardNext,
  clickPost,
  createHumanWait,
  createWriteLog,
  dismissOverlays,
  fillPostText,
  finalizeFacebookPublish,
  gotoHome,
  pickComposerDialog,
  setPrivacyToPublic,
  uploadMedia,
} from "./publish.shared.js";

export type FacebookProfilePublishOptions = {
  /** 侧边栏/导航上的个人主页 link 可见名（codegen: getByRole('link', { name: '...', exact: true })） */
  profileLinkName?: string;
};

/**
 * Facebook 个人主页发帖（对齐 codegen 录制路径）。
 * 入口：facebook.com → 个人主页 link → 「その気持ち、シェアしよう」→ 文案 → 写真・動画 → 次へ → 隐私 → 投稿
 */
async function navigateToProfile(
  ctx: PublishContext,
  writeLog: ReturnType<typeof createWriteLog>,
  profileLinkName?: string,
) {
  const { page } = ctx;

  if (profileLinkName?.trim()) {
    const link = page.getByRole("link", { name: profileLinkName.trim(), exact: true }).first();
    await link.waitFor({ state: "visible", timeout: 30_000 });
    await link.click({ timeout: 30_000 });
    writeLog(`[profile] clicked profile link name=${JSON.stringify(profileLinkName.trim())}`);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return;
  }

  writeLog("[profile] profile_link_name not set, fallback goto /me");
  await page.goto("https://www.facebook.com/me", { waitUntil: "domcontentloaded", timeout: 60_000 });
}

async function openComposerFromProfile(ctx: PublishContext, writeLog: ReturnType<typeof createWriteLog>): Promise<Locator> {
  const { page } = ctx;

  const byRoleCandidates = [
    () => page.getByRole("button", { name: "その気持ち、シェアしよう", exact: true }).first(),
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
      writeLog(`[profile] open composer trigger=role_button index=${i}`);
      const dialog = await pickComposerDialog(page, writeLog);
      writeLog("[profile] open composer dialog picked (has textbox)");
      return dialog;
    } catch {
      // try next
    }
  }

  throw new Error("[profile] 找不到个人主页上的发帖入口（その気持ち、シェアしよう 等）");
}

export async function publishFromProfile(
  ctx: PublishContext,
  options: FacebookProfilePublishOptions = {},
): Promise<PublishResult> {
  const writeLog = createWriteLog(ctx.artifacts.logPath);
  const humanWait = createHumanWait(ctx.page, writeLog);
  const dismiss = () => dismissOverlays(ctx.page, writeLog, humanWait);

  writeLog(`[profile] facebook publish entry=profile_page link=${JSON.stringify(options.profileLinkName ?? "")}`);

  await gotoHome(ctx.page, humanWait, dismiss);
  const auth = await assertLoggedIn(ctx, writeLog);
  if (auth) return auth;

  const body = assertBody(ctx);

  await gotoHome(ctx.page, humanWait, dismiss);
  await navigateToProfile(ctx, writeLog, options.profileLinkName);
  await dismissOverlays(ctx.page, writeLog, humanWait);

  const dialog = await openComposerFromProfile(ctx, writeLog);
  await fillPostText(ctx.page, dialog, body, writeLog, humanWait);
  await uploadMedia(ctx.page, dialog, ctx.assets.mediaFiles, ctx.options, writeLog);
  await clickMediaWizardNext(ctx.page, writeLog);
  await setPrivacyToPublic(ctx.page, writeLog);
  await dismissOverlays(ctx.page, writeLog, humanWait);
  await clickPost(ctx.page, dialog, writeLog, { clickWizardNextFirst: false, waitForEnabled: true });

  return finalizeFacebookPublish(ctx, writeLog);
}
