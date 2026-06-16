import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";
import { humanWaitAfterPublishClick, POST_PUBLISH_SETTLE_MS } from "../shared/humanDelay.js";

/** 与 codegen 一致：Studio 上传页 */
const UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload";
/** 视频已选择后，到点击「发布/投稿」前需至少等待的毫秒数（上传与检查） */
const MIN_MS_FROM_UPLOAD_TO_PUBLISH = 21_000;
/** 进入上传页并确认登录后，到点击「选择视频」前等待（页面/弹窗需时间稳定） */
const SETTLE_MS_BEFORE_SELECT_VIDEO = 10_000;

function extLower(p: string): string {
  const idx = p.lastIndexOf(".");
  return idx >= 0 ? p.slice(idx).toLowerCase() : "";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 最终「投稿/发布」主 CTA：与 artifacts/tiktok.codegen 的 `getByRole('button', { name: '投稿' })` 对齐。
 * 不采用 Share/シェア（常点到分享相关）；不采用 .first()（常点到非发布区）。优先 e2e，再 main 内 exact name，多匹配用 .last()。
 */
async function locateTiktokFinalPublishButton(
  page: Page,
  writeLog: (m: string) => void,
): Promise<Locator | null> {
  const e2eList = [
    "[data-e2e='post-content-button']",
    "[data-e2e='post_video_button']",
    "[data-e2e='upload_post_button']",
    "[data-e2e='post_button']",
    "[data-e2e='publish']",
  ];
  for (const sel of e2eList) {
    const loc = page.locator(sel);
    if ((await loc.count()) === 0) continue;
    const pick = (await loc.count()) > 1 ? loc.last() : loc.first();
    if (await pick.isVisible().catch(() => false)) {
      writeLog(`TikTok 发布 CTA: ${sel}`);
      return pick;
    }
  }

  const hasMain = (await page.locator("main").count()) > 0;
  const scope: Page | Locator = hasMain ? page.locator("main") : page;
  const exact: { n: string; ex?: boolean }[] = [
    { n: "投稿", ex: true },
    { n: "发布", ex: true },
    { n: "Post", ex: true },
    { n: "Publish", ex: true },
  ];
  for (const { n, ex } of exact) {
    const b = scope.getByRole("button", { name: n, exact: ex === true ? true : false });
    const cnt = await b.count();
    if (cnt === 0) continue;
    const pick = cnt > 1 ? b.last() : b.first();
    if (await pick.isVisible().catch(() => false)) {
      writeLog(`TikTok 发布 CTA: main 内 getByRole button name='${n}' exact (n=${cnt} → last if n>1)`);
      return pick;
    }
  }

  for (const n of ["投稿", "发布", "Post", "Publish"] as const) {
    const b = page.getByRole("button", { name: n, exact: true });
    const cnt = await b.count();
    if (cnt === 0) continue;
    const pick = cnt > 1 ? b.last() : b.first();
    if (await pick.isVisible().catch(() => false)) {
      writeLog(`TikTok 发布 CTA: 全页 fallback name='${n}' exact (n=${cnt} → last if n>1)`);
      return pick;
    }
  }

  return null;
}

/** 选完文件、进入发布态之后：用可访问性 + Studio 常见遮挡（如「手机预览」弹层常无 aria-modal） */
async function hasLikelyModalOverlay(page: Page): Promise<boolean> {
  // Studio 常见：白色提示卡 + 底部「OK」（未必挂 dialog/aria-modal）
  const okBtn = page.getByRole("button", { name: /^OK$/i });
  if ((await okBtn.count()) > 0 && (await okBtn.first().isVisible().catch(() => false))) return true;

  const selectors = ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]'];
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 10); i += 1) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox();
      if (box && box.width >= 32 && box.height >= 32) return true;
    }
  }

  // 部分实现用 div[role=button] 承载「OK」
  const okDiv = page.locator('[role="button"]').filter({ hasText: /^OK$/i });
  if ((await okDiv.count()) > 0 && (await okDiv.first().isVisible().catch(() => false))) return true;

  return false;
}

/** 仅点「OK / 知道了」等可定位的关闭钮（不做视口随机/坐标点击） */
async function tryClickStudioOverlayPrimaryButton(
  page: Page,
  writeLog: (m: string) => void,
  phase: string,
): Promise<boolean> {
  const tryOne = async (label: string, loc: Locator): Promise<boolean> => {
    try {
      const n = await loc.count();
      if (n === 0) return false;
      const first = loc.first();
      if (!(await first.isVisible({ timeout: 800 }).catch(() => false))) return false;
      await first.click({ timeout: 4000 });
      writeLog(`TikTok 遮挡[${phase}]: 已点击「${label}」关闭提示`);
      await page.waitForTimeout(400);
      return true;
    } catch {
      return false;
    }
  };

  if (await tryOne("OK", page.getByRole("button", { name: /^OK$/i }))) return true;
  if (await tryOne("OK(div-role)", page.locator('[role="button"]').filter({ hasText: /^OK$/i }))) return true;
  if (await tryOne("OK(native)", page.locator("button").filter({ hasText: /^OK$/i }))) return true;
  if (await tryOne("Got it", page.getByRole("button", { name: /^(Got it|我知道了|知道了|确定|Done)$/i }))) return true;
  if (await tryOne("閉じる", page.getByRole("button", { name: /^(閉じる|关闭|Close)$/i }))) return true;
  return false;
}

/**
 * 进入发布态后：只尝试点 OK / 知道了 等关闭钮；不对手势做视口上的任意/随机位置点击。
 */
async function tryDismissPublishOverlayIfNeeded(
  page: Page,
  writeLog: (m: string) => void,
  phase: string,
): Promise<void> {
  if (await tryClickStudioOverlayPrimaryButton(page, writeLog, phase)) {
    if (await hasLikelyModalOverlay(page)) {
      writeLog(`TikTok 遮挡[${phase}]: 点关闭后仍可能有遮挡（已禁用坐标点击）`);
    } else {
      writeLog(`TikTok 遮挡[${phase}]: 点关闭后未再检测到遮挡`);
    }
    return;
  }

  if (!(await hasLikelyModalOverlay(page))) {
    writeLog(`TikTok 遮挡[${phase}]: 未检测到遮挡`);
    return;
  }

  writeLog(`TikTok 遮挡[${phase}]: 检测到遮挡但无匹配关闭按钮（已禁用坐标点击）`);
}

/** 说明区 placeholder 日/中/英 常见片段（Studio 会换文案） */
const CAPTION_PLACEHOLDER_HINT = /caption|Describe|Tell viewers|説明|キャプション|説明を|描述|说明|Add a|タイトル|Title|What.*say|何を|詳細|Detail/i;

async function typeIntoTiktokField(loc: Locator, text: string): Promise<void> {
  try {
    await loc.fill(text, { timeout: 20_000 });
  } catch {
    await loc.click({ timeout: 12_000, force: true });
    await loc.press("ControlOrMeta+a");
    await loc.press("Backspace");
    await loc.pressSequentially(text, { delay: 8 });
  }
}

/**
 * 填写视频说明/キャプション。日本 Studio 常无英文 Describe，且用 combobox/ contenteditable 时 fill 易失败，故多路兜底。
 */
async function fillTiktokCaption(
  page: Page,
  body: string,
  partForCombobox: string,
  writeLog: (m: string) => void,
): Promise<boolean> {
  const w = (m: string) => writeLog(`TikTok caption: ${m}`);
  await page.waitForTimeout(500);

  const hasMain = (await page.locator("main").count()) > 0;
  const scope: Page | Locator = hasMain ? page.locator("main") : page;

  // TikTok Studio（日本 UI）常用 DraftJS：data-e2e="caption_container"
  // 注意：有时该区块在子 frame 里渲染；因此同时在 main frame 与所有 frames 中尝试。
  const tryDraftJsInRoot = async (label: string, root: Pick<Page | Frame, "locator">): Promise<boolean> => {
    const captionRoot = root.locator("[data-e2e='caption_container']").first();
    // 给编辑区一点时间出现（上传后可能延迟渲染）
    try {
      await captionRoot.waitFor({ state: "attached", timeout: 20_000 });
    } catch {
      return false;
    }
    try {
      await captionRoot.scrollIntoViewIfNeeded().catch(() => {});
    } catch {
      /* ignore */
    }

    const editableCandidates = [
      captionRoot.locator("div.public-DraftEditor-content[contenteditable='true']").first(),
      captionRoot.locator("[contenteditable='true']").first(),
      captionRoot.locator("div.public-DraftEditor-content").first(),
    ];
    for (const ed of editableCandidates) {
      try {
        if ((await ed.count()) === 0) continue;
        await ed.waitFor({ state: "visible", timeout: 35_000 });
        await ed.click({ timeout: 12_000, force: true });
        await ed.press("ControlOrMeta+a");
        await ed.press("Backspace");
        await ed.pressSequentially(body, { delay: 8 });
        w(`ok DraftJS(${label}) caption_container contenteditable`);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  };

  try {
    if (await tryDraftJsInRoot("main", page)) return true;
    for (const fr of page.frames().filter((f) => f !== page.mainFrame())) {
      if (await tryDraftJsInRoot(`frame:${fr.url().slice(0, 64)}`, fr)) return true;
    }
  } catch (e) {
    w(`DraftJS caption_container 失败: ${String(e)}`);
  }

  try {
    const byPh = page.getByPlaceholder(CAPTION_PLACEHOLDER_HINT);
    if ((await byPh.count()) > 0) {
      const t = (await byPh.count()) > 1 ? byPh.last() : byPh.first();
      await t.waitFor({ state: "visible", timeout: 35_000 });
      await typeIntoTiktokField(t, body);
      w("ok getByPlaceholder");
      return true;
    }
  } catch (e) {
    w(`getByPlaceholder 失败: ${String(e)}`);
  }

  try {
    const byLabel = page.getByLabel(
      /caption|説明|キャプション|描述|说明|Add a title|Title|视频说明|詳細|Details|説明を追加/i,
    );
    if ((await byLabel.count()) > 0) {
      const t = (await byLabel.count()) > 1 ? byLabel.last() : byLabel.first();
      await t.waitFor({ state: "visible", timeout: 20_000 });
      await typeIntoTiktokField(t, body);
      w("ok getByLabel");
      return true;
    }
  } catch (e) {
    w(`getByLabel 失败: ${String(e)}`);
  }

  try {
    const tb = page.getByRole("textbox", {
      name: /caption|説明|キャプション|Title|title|Description|描述|说明|Add|Describe|Details|説明を/i,
    });
    if ((await tb.count()) > 0) {
      const t = (await tb.count()) > 1 ? tb.last() : tb.first();
      await t.waitFor({ state: "visible", timeout: 25_000 });
      await typeIntoTiktokField(t, body);
      w("ok getByRole textbox");
      return true;
    }
  } catch (e) {
    w(`getByRole textbox 失败: ${String(e)}`);
  }

  try {
    const c1 = scope
      .getByRole("combobox")
      .filter({ hasText: new RegExp(escapeRe(partForCombobox)) });
    if ((await c1.count()) > 0) {
      const t = c1.first();
      await t.waitFor({ state: "visible", timeout: 25_000 });
      await t.click({ timeout: 12_000 });
      // 该输入框常默认带视频文件名：必须先清空再输入
      await typeIntoTiktokField(t, body);
      w("ok combobox(含文件名片段，同 codegen)");
      return true;
    }
  } catch (e) {
    w(`combobox+filename 失败: ${String(e)}`);
  }

  try {
    const c2 = scope.getByRole("combobox");
    if ((await c2.count()) > 0) {
      const t = c2.last();
      await t.waitFor({ state: "visible", timeout: 25_000 });
      await t.click({ timeout: 12_000 });
      // 该输入框常默认带视频文件名：必须先清空再输入
      await typeIntoTiktokField(t, body);
      w("ok combobox last（主说明区多在后/下）");
      return true;
    }
  } catch (e) {
    w(`combobox last 失败: ${String(e)}`);
  }

  const textareas = [
    "textarea[placeholder*='Describe']",
    "textarea[placeholder*='describe']",
    "textarea[placeholder*='説明']",
    "textarea[placeholder*='描述']",
    "textarea[placeholder*='说明']",
    "textarea[placeholder*='caption']",
    "textarea[placeholder*='Caption']",
    "main textarea",
    "textarea",
  ];
  for (const sel of textareas) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) === 0) continue;
      const t = (await loc.count()) > 1 ? loc.last() : loc.first();
      await t.waitFor({ state: "visible", timeout: 20_000 });
      await typeIntoTiktokField(t, body);
      w(`ok textarea ${sel}`);
      return true;
    } catch {
      /* 下一个 */
    }
  }

  try {
    const ce = scope.locator('div[contenteditable="true"]');
    const n = await ce.count();
    if (n > 0) {
      const t = n > 1 ? ce.last() : ce.first();
      await t.waitFor({ state: "visible", timeout: 25_000 });
      await t.click({ timeout: 12_000, force: true });
      await t.press("ControlOrMeta+a");
      await t.press("Backspace");
      await t.pressSequentially(body, { delay: 8 });
      w("ok contenteditable（键盘输入）");
      return true;
    }
  } catch (e) {
    w(`contenteditable 失败: ${String(e)}`);
  }

  w("未匹配到任何说明输入（界面语言或组件更新时需新选择器）");
  return false;
}

async function waitAtLeastMsSince(
  t0: number,
  minMs: number,
  page: Page,
  writeLog: (m: string) => void,
) {
  const el = Date.now() - t0;
  if (el < minMs) {
    const d = minMs - el;
    writeLog(`wait from file select to >=${minMs}ms before publish: +${d}ms`);
    await page.waitForTimeout(d);
  }
}

/**
 * 「选择/上传」视频：多语言，匹配 codegen；勿用全词锚定（界面常有「选择文件」「Select videos」等变体）
 */
function selectVideoButton(page: Page) {
  return page.getByRole("button", {
    name: /(動画を選択|选择视频|选择文件|Upload( your)?\s*video|Select( files?| your)?\s*video|Upload( video)?|上[传傳]|上传)/i,
  });
}

/**
 * 与小红书类似：Studio 首屏经常晚于 domcontentloaded 才出头像/链接，仅看 DOM 易误判为未登录。
 * 用 cookie 兜底，并认「能选视频」= 有上传权。
 */
async function hasTiktokSessionCookies(context: BrowserContext, writeLog?: (m: string) => void): Promise<boolean> {
  try {
    const all = await context.cookies();
    for (const c of all) {
      const d = c.domain || "";
      if (!d.replace(/^\./, "").endsWith("tiktok.com") && !d.includes("tiktok.com")) continue;
      const v = String(c.value ?? "");
      if (!v.trim()) continue;
      if (c.name === "sessionid" && v.length > 4) {
        if (writeLog) writeLog("TikTok login: cookie sessionid 存在");
        return true;
      }
      if (c.name === "sid_guard" && v.length > 2) {
        if (writeLog) writeLog("TikTok login: cookie sid_guard 存在");
        return true;
      }
      if (c.name === "multi_sids" && v.length > 2) {
        if (writeLog) writeLog("TikTok login: cookie multi_sids 存在");
        return true;
      }
    }
  } catch {
    /* 忽略 */
  }
  return false;
}

/** 主站/通行证登录页，非 Studio 内嵌上传页 */
function isTiktokStandaloneLoginPage(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.includes("tiktok.com") && !u.includes("bytedance")) return false;
  if (u.includes("tiktokstudio")) return false;
  if (u.includes("/passport/") && (u.includes("auth") || u.includes("web_login") || u.includes("login")))
    return true;
  if (/\/(login|signup|signin)([/?#]|$)/i.test(u)) return true;
  return u.includes("showlogin") && u.includes("www.tiktok.com");
}

async function isLoggedIn(
  page: Page,
  context: BrowserContext,
  writeLog?: (m: string) => void,
): Promise<boolean> {
  try {
    const url = page.url();
    if (isTiktokStandaloneLoginPage(url)) {
      if (writeLog) writeLog(`TikTok login: false 在独立登录/通行证页 url=${url}`);
      return false;
    }

    if (await hasTiktokSessionCookies(context, writeLog)) return true;

    const domSelectors = [
      "a[href^='/@']",
      "[data-e2e='topbar-profile']",
      "[data-e2e='profile-icon']",
      "header a[href*='/@']",
    ];
    for (const sel of domSelectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        if (writeLog) writeLog(`TikTok login: true DOM ${sel}`);
        return true;
      }
    }

    // Studio 上传：与录制一致，出现「动图/选视频」说明已能进入发布流程
    const selBtn = selectVideoButton(page);
    if ((await selBtn.count()) > 0 && (await selBtn.first().isVisible().catch(() => false))) {
      if (writeLog) writeLog("TikTok login: true 可见「选择/上传」视频按钮");
      return true;
    }
    {
      const onStudio = url.toLowerCase().includes("tiktokstudio") || /tiktok\.com\/.+upload/.test(url.toLowerCase());
      if (onStudio && (await page.locator("input[type='file']").count()) > 0) {
        if (writeLog) writeLog("TikTok login: true Studio/上传 页有 file input(常为 hidden)");
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function waitForLoggedIn(
  page: Page,
  context: BrowserContext,
  writeLog: (m: string) => void,
  timeoutMs = 40_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const u = page.url();
    if (isTiktokStandaloneLoginPage(u)) {
      writeLog(`TikTok waitForLoggedIn: 在独立登录/通行证页，视为未以发布流程登录 url=${u}`);
      return false;
    }
    if (await isLoggedIn(page, context, writeLog)) {
      return true;
    }
    await page.waitForTimeout(800);
  }
  writeLog(`TikTok waitForLoggedIn: 超时 ${timeoutMs}ms，仍无登录信号 url=${page.url()}`);
  return false;
}

type LocatorRoot = Pick<Page | Frame, "locator">;

/** 在 frame 与主文档上试隐藏 file input；不在此处乱点全屏，避免点掉 Studio 上传卡片 */
async function setVideoFile(page: Page, videoFile: string, writeLog: (m: string) => void) {
  const trySetFilesOn = async (label: string, root: LocatorRoot): Promise<boolean> => {
    const ins = root.locator("input[type='file']");
    const n = await ins.count();
    for (let i = 0; i < n; i += 1) {
      const item = ins.nth(i);
      try {
        await item.setInputFiles([videoFile], { timeout: 120_000 });
        writeLog(`setVideoFile: setInputFiles on file input (${label}#${i})`);
        return true;
      } catch {
        /* 下一个 */
      }
    }
    return false;
  };

  if (await trySetFilesOn("main", page)) return;
  for (const fr of page.frames().filter((f) => f !== page.mainFrame())) {
    if (await trySetFilesOn(`frame:${fr.url().slice(0, 64)}`, fr)) return;
  }

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch {
    /* 忽略 */
  }
  if (await trySetFilesOn("main-after-escape", page)) return;

  const btn = selectVideoButton(page);
  if ((await btn.count()) > 0) {
    const fileEvent = page.waitForEvent("filechooser", { timeout: 30_000 }).catch(() => null);
    try {
      await btn.first().click({ timeout: 15_000 });
    } catch {
      /* 可能已打开或遮挡 */
    }
    const chooser = await fileEvent;
    if (chooser) {
      await chooser.setFiles([videoFile]);
      writeLog("setVideoFile: filechooser on select-video button");
      return;
    }
  }

  for (const loc of [selectVideoButton(page), page.locator("input[type='file']")]) {
    if ((await loc.count()) === 0) continue;
    try {
      const first = loc.first();
      await first.setInputFiles([videoFile], { timeout: 120_000 });
      writeLog("setVideoFile: setInputFiles (fallback same root)");
      return;
    } catch {
      continue;
    }
  }
  throw new Error("TikTok：无法通过「选择视频」按钮或 file input 上传（请录一张 Studio 当前上传页发我）");
}

export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const { page, context, assets, artifacts, target, job, options } = ctx;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const body = assets.caption.trim();
  if (!body) {
    return {
      status: "skipped",
      platform: "tiktok",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason: "content.body 为空，按规则跳过该平台发布",
      artifacts,
    };
  }

  if (options.mode !== "video") {
    return {
      status: "skipped",
      platform: "tiktok",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason: "TikTok 暂仅支持 --mode video（视频上传）",
      artifacts,
    };
  }

  const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);
  const videos = assets.mediaFiles.filter((p) => videoExts.has(extLower(p)));
  if (videos.length === 0) throw new Error("TikTok video 模式需要 1 个本机视频文件（job.video 绝对路径）");
  const videoFile = videos[0]!;
  const fileBase = path.basename(videoFile);
  const partForCombobox = fileBase.slice(0, Math.min(32, fileBase.length));

  await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  try {
    await page.waitForLoadState("load", { timeout: 25_000 });
  } catch {
    /* 单页资源慢时仍继续 */
  }
  await page.waitForTimeout(600);

  if (!(await waitForLoggedIn(page, context, writeLog, 40_000))) {
    const reason =
      "TikTok 未检测到已登录：Cookie/Studio 控件在限时内未就绪。请先 npm run login -- --platform tiktok 确认持久会话，或稍后重试（首屏常较慢）。";
    writeLog(reason);
    return {
      status: "auth_expired",
      platform: "tiktok",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason,
      artifacts,
    };
  }

  writeLog(`进入上传页并确认登录后，等待 ${SETTLE_MS_BEFORE_SELECT_VIDEO / 1000}s 再开始选择视频`);
  await page.waitForTimeout(SETTLE_MS_BEFORE_SELECT_VIDEO);

  let tAfterFileSelect: number;
  try {
    await setVideoFile(page, videoFile, writeLog);
    tAfterFileSelect = Date.now();
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }

  await tryDismissPublishOverlayIfNeeded(page, writeLog, "选文件后");

  // 点击与文件名一致的区块（codegen: locator('div').filter hasText 文件名）
  try {
    const reFile = new RegExp(`^${escapeRe(fileBase)}$`);
    const row = page.locator("div").filter({ hasText: reFile }).first();
    if ((await row.count()) > 0) {
      await row.click({ timeout: 15_000, force: true });
      writeLog("clicked file-name row (codegen)");
    }
  } catch {
    writeLog("file-name row click skipped or failed");
  }
  await tryDismissPublishOverlayIfNeeded(page, writeLog, "点选文件名后");

  const filled = await fillTiktokCaption(page, body, partForCombobox, writeLog);
  if (!filled) writeLog("TikTok: 说明未写入，发布仍继续（可手动补或发页面结构再收窄选择器）");

  // codegen：可选地点（如 Tokyo）—— 仅当存在时轻点
  try {
    const tokyo = page.getByText("Tokyo", { exact: true });
    if ((await tokyo.count()) > 0) {
      await tokyo.first().click({ timeout: 3000, force: true });
      writeLog("clicked optional location Tokyo (codegen)");
    }
  } catch {
    /* 忽略 */
  }

  await tryDismissPublishOverlayIfNeeded(page, writeLog, "填文案后");

  // 发布前：距「视频已选择/上传入队」须超过 20s（含上传与检查时间）
  await waitAtLeastMsSince(tAfterFileSelect, MIN_MS_FROM_UPLOAD_TO_PUBLISH, page, writeLog);

  const returnPublished = (): PublishResult => ({
    status: "published",
    platform: "tiktok",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    published_at: nowIso(),
    artifacts,
  });

  const tPublishWait = Date.now();
  let publishBtn: Locator | null = null;
  while (Date.now() - tPublishWait < 90_000) {
    publishBtn = await locateTiktokFinalPublishButton(page, writeLog);
    if (publishBtn) break;
    await page.waitForTimeout(1000);
  }
  if (!publishBtn) {
    await tryDismissPublishOverlayIfNeeded(page, writeLog, "等发布钮失败重试前");
    await page.waitForTimeout(800);
    publishBtn = await locateTiktokFinalPublishButton(page, writeLog);
  }

  if (publishBtn) {
    try {
      await publishBtn.waitFor({ state: "visible", timeout: 30_000 });
      await publishBtn.click({ timeout: 60_000, force: true });
      writeLog("clicked TikTok 最终发布按钮（e2e 或 main 内 exact 投稿/发布/Post/Publish，多匹配取 last）");
      await humanWaitAfterPublishClick(page, writeLog, POST_PUBLISH_SETTLE_MS);
      return returnPublished();
    } catch (e) {
      writeLog(`TikTok 发布按钮点击失败: ${String(e)}，尝试次要选择器（不含 Share/シェア）`);
    }
  }

  const publishSelectors: string[] = [
    "[data-e2e='post-button']",
    "button:has-text('投稿')",
    "button:has-text('发布')",
    "button:has-text('Post')",
    "button:has-text('Publish')",
  ];
  for (const sel of publishSelectors) {
    try {
      const all = page.locator(sel);
      if ((await all.count()) === 0) continue;
      const btn = (await all.count()) > 1 ? all.last() : all.first();
      await btn.waitFor({ state: "visible", timeout: 30_000 });
      await waitAtLeastMsSince(tAfterFileSelect, MIN_MS_FROM_UPLOAD_TO_PUBLISH, page, writeLog);
      await btn.click({ timeout: 60_000, force: true });
      writeLog(`clicked publish fallback selector=${sel} (n>1 时 last)`);
      await humanWaitAfterPublishClick(page, writeLog, POST_PUBLISH_SETTLE_MS);
      return returnPublished();
    } catch {
      continue;
    }
  }

  return {
    status: "manual_required",
    platform: "tiktok",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    error: "未能定位 TikTok 发布按钮（可再次对照 tiktokstudio/upload 页面与 codegen 更新选择器）",
    artifacts,
  };
}
