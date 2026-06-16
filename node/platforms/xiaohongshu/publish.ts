import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { ManualRequiredError } from "../../src/shared/errors.js";
import { nowIso } from "../../src/shared/time.js";
import { humanStepWait, humanWaitAfterPublishClick, withHumanPacing } from "../shared/humanDelay.js";

/**
 * 小红书创作者后台图文/视频发布。
 * 持久 Chrome profile、artifacts 日志、人工登录兜底。
 */
const HOME_URL = "https://creator.xiaohongshu.com/new/home";
const IMAGE_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";
const VIDEO_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
/** shadow 内红色发布按钮（DevTools: xhs-publish-btn → button.ce-btn.bg-red） */
const XHS_INNER_PUBLISH_SELECTOR = "xhs-publish-btn button.bg-red";

class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

function extractPostId(url: string): string | null {
  const m = url.match(/([a-f0-9]{24,})/i);
  return m?.[1] ?? null;
}

async function waitForVisible(
  page: Page,
  selectors: string[],
  timeoutMs: number,
): Promise<{ locator: Locator; selector: string }> {
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
  throw new PublishError(`No visible selector matched: ${JSON.stringify(selectors)}; last_error=${String(lastError)}`);
}

async function clickAny(page: Page, selectors: string[], writeLog: (m: string) => void, timeoutMs = 10_000): Promise<string> {
  const { locator, selector } = await waitForVisible(page, selectors, timeoutMs);
  await locator.click({ timeout: timeoutMs });
  writeLog(`clicked selector=${selector}`);
  return selector;
}

async function fillTitle(page: Page, title: string, writeLog: (m: string) => void): Promise<void> {
  await withHumanPacing(
    page,
    "fill_title",
    async () => {
      const roleCandidates = [
        () => page.getByRole("textbox", { name: /填写标题会有更多赞哦/ }).first(),
        () => page.getByRole("textbox", { name: /填写标题/ }).first(),
      ];
      for (let i = 0; i < roleCandidates.length; i += 1) {
        try {
          const loc = roleCandidates[i]!();
          await loc.waitFor({ state: "visible", timeout: 15_000 });
          await loc.click();
          await loc.fill("");
          await loc.fill(title);
          writeLog(`filled title role index=${i}`);
          return;
        } catch {
          // try next
        }
      }
      const selectors = ["input[placeholder*='填写标题']", "input[placeholder*='标题']", "textarea[placeholder*='标题']"];
      const { locator, selector } = await waitForVisible(page, selectors, 15_000);
      await locator.click();
      await locator.fill("");
      await locator.fill(title);
      writeLog(`filled title selector=${selector}`);
    },
    writeLog,
  );
}

function normalizeBodyText(body: string): string {
  let text = String(body ?? "");
  text = text.replace(/\\r\\n/g, "\n");
  text = text.replace(/\\n/g, "\n");
  text = text.replace(/\\r/g, "\n");
  return text.trim();
}

async function fillBody(page: Page, body: string, writeLog: (m: string) => void): Promise<void> {
  await withHumanPacing(page, "fill_body", async () => {
  const normalizedBody = normalizeBodyText(body);
  try {
    await page.getByRole("paragraph").first().click({ timeout: 10_000 });
    const bodyBox = page.getByRole("textbox").nth(1);
    await bodyBox.waitFor({ state: "visible", timeout: 15_000 });
    await bodyBox.click();
    await bodyBox.fill("");
    await bodyBox.fill(normalizedBody);
    writeLog("filled body via role paragraph + textbox.nth(1)");
    return;
  } catch (e) {
    writeLog(`role body fill failed: ${String(e)}`);
  }

  const selectors = [
    "[contenteditable='true'][data-placeholder*='正文']",
    "[contenteditable='true'][placeholder*='正文']",
    "div[contenteditable='true']",
    "textarea[placeholder*='输入正文描述']",
    "textarea[placeholder*='正文']",
  ];
  let lastError: unknown;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 15_000 });
      await locator.click();
      if (selector.startsWith("textarea")) {
        await locator.fill("");
        await locator.fill(normalizedBody);
        const previewText = ((await locator.inputValue()) ?? "").trim();
        if (normalizedBody.slice(0, 20) && !previewText.includes(normalizedBody.slice(0, 20))) {
          throw new PublishError(`Body verification failed for selector=${selector}`);
        }
      } else {
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.insertText(normalizedBody);
        await page.waitForTimeout(500);
        const previewText = ((await locator.innerText()) ?? "").trim();
        if (normalizedBody.slice(0, 20) && !previewText.includes(normalizedBody.slice(0, 20))) {
          throw new PublishError(`Body verification failed for selector=${selector}`);
        }
      }
      writeLog(`filled body selector=${selector}`);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw new PublishError(`Could not fill body editor: ${String(lastError)}`);
  }, writeLog);
}

function normalizeTags(tags: unknown): string[] {
  const cleaned: string[] = [];
  if (!Array.isArray(tags)) return cleaned;
  for (const tag of tags) {
    const value = String(tag)
      .trim()
      .replace(/^#+/, "")
      .trim();
    if (value && !cleaned.includes(value)) cleaned.push(value);
  }
  return cleaned;
}

async function clickTopicSuggestion(page: Page, tag: string, writeLog: (m: string) => void): Promise<boolean> {
  const suggestionSelectors = [
    `[role='listbox'] :text('#${tag}')`,
    `[role='option'] :text('#${tag}')`,
    `.ant-select-dropdown :text('#${tag}')`,
    `.ant-popover :text('#${tag}')`,
    `.ant-mentions-dropdown :text('#${tag}')`,
    `.ant-dropdown :text('#${tag}')`,
    `[data-tippy-root] :text('#${tag}')`,
    `div[class*='dropdown'] :text('#${tag}')`,
    `div[class*='popover'] :text('#${tag}')`,
  ];
  for (const selector of suggestionSelectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.waitFor({ state: "visible", timeout: 1500 });
        await locator.click({ timeout: 1500 });
        writeLog(`clicked topic suggestion selector=${selector}`);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function fillTags(page: Page, tags: string[], writeLog: (m: string) => void): Promise<void> {
  const normalized = normalizeTags(tags);
  if (normalized.length === 0) {
    writeLog("no tags to fill");
    return;
  }

  await humanStepWait(page, writeLog, "fill_tags:before");

  const bodyEditorSelectors = [
    "[contenteditable='true'][data-placeholder*='正文']",
    "[contenteditable='true'][placeholder*='正文']",
    "div[contenteditable='true']",
  ];

  let bodyEditor: Locator | null = null;
  for (const selector of bodyEditorSelectors) {
    try {
      const candidate = page.locator(selector).first();
      await candidate.waitFor({ state: "visible", timeout: 5000 });
      bodyEditor = candidate;
      writeLog(`selected body editor for tags selector=${selector}`);
      break;
    } catch {
      continue;
    }
  }

  if (!bodyEditor) throw new PublishError("Could not locate body editor for tags");

  const beforeText = ((await bodyEditor.innerText()) ?? "").trim();
  await bodyEditor.click({ timeout: 10_000 });
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  writeLog("moved tags to final line after blank line");

  let selectedCount = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const tag = normalized[index]!;
    try {
      const prefix = index === 0 ? "#" : " #";
      await page.keyboard.insertText(`${prefix}${tag}`);
      await page.waitForTimeout(800);

      if (await clickTopicSuggestion(page, tag, writeLog)) {
        selectedCount += 1;
        continue;
      }

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);

      if (await clickTopicSuggestion(page, tag, writeLog)) {
        selectedCount += 1;
        continue;
      }

      await page.keyboard.press("Control+Z");
      writeLog(`topic suggestion not confirmed, reverted raw text for tag=#${tag}`);
    } catch (e) {
      try {
        await page.keyboard.press("Control+Z");
      } catch {
        // ignore
      }
      writeLog(`topic handling failed for tag=#${tag}: ${String(e)}`);
    }
  }

  const afterText = ((await bodyEditor.innerText()) ?? "").trim();
  if (beforeText && beforeText.slice(0, 20) && !afterText.includes(beforeText.slice(0, 20))) {
    throw new PublishError("Body content disappeared after filling tags");
  }

  writeLog(`filled tags count=${selectedCount}`);
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
  await humanStepWait(page, writeLog, "fill_tags:after");
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const checks = [
    (await page.locator("text=发布笔记").count()) > 0,
    (await page.locator("text=上传图文").count()) > 0,
    (await page.locator("text=笔记管理").count()) > 0,
    page.url().includes("creator.xiaohongshu.com") && (await page.locator("text=草稿箱").count()) > 0,
  ];
  return checks.some(Boolean);
}

async function waitForLoggedIn(page: Page, writeLog: (m: string) => void, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes("/login")) {
      writeLog(`detected login redirect url=${url}`);
      return false;
    }
    if (await isLoggedIn(page)) return true;
    await page.waitForTimeout(800);
  }
  writeLog(`login check timeout url=${page.url()}`);
  return false;
}

/**
 * 小红书创作者后台通常需「手机验证码」登录，脚本不读取账号 YAML、不代填密码。
 * 仅两种路径：① 持久 profile / storageState 仍有效 → 直接继续；② 否则必须在可见浏览器里由用户手动完成验证。
 */
async function ensureLogin(
  page: Page,
  writeLog: (m: string) => void,
  opts: { headless: boolean },
): Promise<void> {
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  writeLog(`goto home url=${page.url()}`);

  for (let i = 0; i < 5; i += 1) {
    if (await isLoggedIn(page)) {
      writeLog("已检测到有效登录态（持久化会话可用）");
      return;
    }
    await page.waitForTimeout(1000);
  }

  // 首次或无有效会话、或登录已失效：一律只能手动登录（手机验证码），无自动填表分支
  writeLog(
    "未检测到创作者后台登录态（首次登录或登录已失效）。小红书仅支持在浏览器内手动登录（通常需手机验证码），脚本不会使用账号文件自动填密码。",
  );

  if (opts.headless) {
    throw new ManualRequiredError(
      "小红书登录需要手机验证码，必须在可见浏览器中操作。请将 job.options.headless 设为 false 后重试。",
    );
  }

  writeLog("请在打开的浏览器窗口中完成登录/验证（输入手机号与短信验证码等），完成后将自动继续…");

  const deadline = Date.now() + 300_000;
  let lastUrl = page.url();
  while (Date.now() < deadline) {
    try {
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        writeLog(`页面 URL 已变化: ${currentUrl}`);
        lastUrl = currentUrl;
      }
      if (await isLoggedIn(page)) {
        writeLog("手动登录成功（已重新获得有效会话）");
        return;
      }
    } catch (e) {
      throw new PublishError(`浏览器页面已关闭: ${String(e)}`);
    }
    await page.waitForTimeout(2000);
  }

  throw new ManualRequiredError(
    "等待手动登录超时（300 秒）。请在手机完成验证码后及时回到创作者后台，或检查网络后重试。",
  );
}

async function gotoImagePublish(page: Page, writeLog: (m: string) => void): Promise<void> {
  await page.goto(IMAGE_PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  writeLog(`goto image publish url=${page.url()}`);
  await waitForVisible(page, ["text=上传图片", "text=文字配图", "text=图片编辑"], 30_000);
}

async function uploadImages(page: Page, imagePaths: string[], writeLog: (m: string) => void): Promise<void> {
  await withHumanPacing(
    page,
    "upload_images",
    async () => {
      const uploadBtn = page.getByRole("button", { name: "上传图片" }).first();
      try {
        await uploadBtn.waitFor({ state: "visible", timeout: 20_000 });
        try {
          await uploadBtn.setInputFiles(imagePaths, { timeout: 120_000 });
          writeLog(`uploaded via 上传图片 button setInputFiles count=${imagePaths.length}`);
        } catch (e) {
          writeLog(`上传图片 setInputFiles failed, trying filechooser: ${String(e)}`);
          const chooserPromise = page.waitForEvent("filechooser", { timeout: 15_000 });
          await uploadBtn.click({ timeout: 10_000 });
          const chooser = await chooserPromise;
          await chooser.setFiles(imagePaths);
          writeLog(`uploaded via filechooser count=${imagePaths.length}`);
        }
        await waitForVisible(page, ["text=图片编辑", "text=获取封面建议", "text=笔记预览"], 60_000);
        writeLog("image editor loaded");
        return;
      } catch (e) {
        writeLog(`上传图片 button path failed: ${String(e)}`);
      }

      const fileInputs = ["input[type='file']", "input[accept*='image']"];
      for (const selector of fileInputs) {
        try {
          await page.locator(selector).first().setInputFiles(imagePaths, { timeout: 120_000 });
          writeLog(`uploaded images selector=${selector} count=${imagePaths.length}`);
          await waitForVisible(page, ["text=图片编辑", "text=获取封面建议", "text=笔记预览"], 60_000);
          writeLog("image editor loaded");
          return;
        } catch {
          continue;
        }
      }
      throw new PublishError("Could not find upload file input on image publish page");
    },
    writeLog,
  );
}

async function gotoVideoPublish(page: Page, writeLog: (m: string) => void): Promise<void> {
  await page.goto(VIDEO_PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  writeLog(`goto video publish url=${page.url()}`);
  await waitForVisible(
    page,
    ["text=上传视频", "text=本地上传", "text=从相册", "text=发布", "text=视频", "text=写笔记"],
    20_000,
  );
}

async function uploadVideoFile(page: Page, videoPath: string, writeLog: (m: string) => void): Promise<void> {
  await withHumanPacing(page, "upload_video", async () => {
  const fileInputs = [
    "input[type='file']",
    "input[accept*='video']",
    "input[accept*='mp4']",
    'input[accept*="video/*"]',
  ];
  for (const selector of fileInputs) {
    try {
      const el = page.locator(selector).first();
      if ((await el.count()) === 0) continue;
      await el.setInputFiles([videoPath], { timeout: 120_000 });
      writeLog(`uploaded video selector=${selector} path=${videoPath}`);
      await waitForVisible(page, ["text=发布", "text=封面", "text=视频", "text=标题", "text=笔记"], 45_000);
      return;
    } catch {
      continue;
    }
  }
  throw new PublishError("Could not find upload file input on video publish page");
  }, writeLog);
}

/** 将 closed shadow 强制为 open，便于 Playwright 穿透 xhs-publish-btn。须在 goto 创作者站之前注入。 */
async function ensureOpenShadowRoots(context: BrowserContext, writeLog: (m: string) => void): Promise<void> {
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return orig.call(this, { ...(init ?? {}), mode: "open" });
    };
  });
  writeLog("installed attachShadow→open patch (for xhs-publish-btn)");
}

async function dismissOverlaysBeforePublish(page: Page, writeLog: (m: string) => void): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }
  try {
    const title = page.locator("input[placeholder*='标题'], input[placeholder*='填写标题']").first();
    if ((await title.count()) > 0) {
      await title.click({ timeout: 5000, force: true });
      writeLog("dismiss overlays: clicked title field");
    }
  } catch {
    writeLog("dismiss overlays: title click skipped");
  }
  await page.waitForTimeout(400);
}

async function prepareComposePageBeforePublish(page: Page, writeLog: (m: string) => void): Promise<void> {
  await dismissOverlaysBeforePublish(page, writeLog);

  for (const sel of ["text=笔记预览"]) {
    try {
      const tab = page.locator(sel).first();
      if ((await tab.count()) > 0) {
        await tab.click({ timeout: 3000 });
        writeLog(`prepare: clicked ${sel}`);
        await page.waitForTimeout(500);
      }
    } catch (e) {
      writeLog(`prepare: ${sel} skipped: ${String(e)}`);
    }
  }
}

async function waitForPublishButtonReady(page: Page, writeLog: (m: string) => void): Promise<Locator> {
  const host = page.locator("xhs-publish-btn").first();
  await host.waitFor({ state: "visible", timeout: 30_000 });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const disabled = await host.getAttribute("submit-disabled");
    let bodyText = "";
    try {
      bodyText = (await page.locator("body").innerText({ timeout: 2000 })) ?? "";
    } catch {
      bodyText = "";
    }
    const uploading =
      bodyText.includes("上传中") ||
      bodyText.includes("处理中") ||
      bodyText.includes("正在上传") ||
      bodyText.includes("图片处理");
    if (disabled !== "true" && !uploading) {
      writeLog(`publish button ready submit-disabled=${disabled ?? "unknown"}`);
      return host;
    }
    writeLog(`waiting publish ready disabled=${disabled ?? "?"} uploading=${uploading}`);
    await page.waitForTimeout(1500);
  }

  const disabled = await host.getAttribute("submit-disabled");
  if (disabled === "true") {
    throw new PublishError("xhs-publish-btn submit-disabled=true (timeout waiting ready)");
  }
  return host;
}

async function probePublishShadow(page: Page, writeLog: (m: string) => void): Promise<void> {
  const probe = await page.evaluate(() => {
    const host = document.querySelector("xhs-publish-btn");
    if (!host) return { hasHost: false as const };
    const root = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    const buttons = root
      ? Array.from(root.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())
      : [];
    return { hasHost: true as const, hasShadowRoot: Boolean(root), buttonLabels: buttons };
  });
  writeLog(`shadow probe ${JSON.stringify(probe)}`);
}

async function clickPublishViaShadowLocator(page: Page, writeLog: (m: string) => void): Promise<boolean> {
  writeLog(`[click-attempt] method=shadow-locator selector=${XHS_INNER_PUBLISH_SELECTOR}`);
  try {
    const locator = page.locator(XHS_INNER_PUBLISH_SELECTOR);
    const n = await locator.count();
    if (n === 0) {
      writeLog(`[click-miss] method=shadow-locator count=0`);
      return false;
    }
    const texts = await locator.allTextContents();
    writeLog(`[click-probe] method=shadow-locator count=${n} texts=${JSON.stringify(texts)}`);
    const btn = locator.first();
    await btn.waitFor({ state: "visible", timeout: 5000 });
    await btn.click({ timeout: 10_000 });
    writeLog("[click-ok] method=shadow-locator");
    return true;
  } catch (e) {
    writeLog(`[click-fail] method=shadow-locator: ${String(e)}`);
    return false;
  }
}

/**
 * closed shadow 无法用 locator 穿透时，用 elementFromPoint 点到 shadow 内真实按钮。
 * Chrome 渲染树包含 closed shadow 内元素，坐标点击可生效。
 */
async function clickPublishViaElementFromPoint(
  page: Page,
  host: Locator,
  writeLog: (m: string) => void,
): Promise<boolean> {
  const box = await host.boundingBox();
  if (!box) {
    writeLog("[click-miss] method=elementFromPoint no bounding box");
    return false;
  }

  const points = [
    { x: box.x + box.width * 0.82, y: box.y + box.height * 0.5, label: "82%" },
    { x: box.x + box.width * 0.75, y: box.y + box.height * 0.5, label: "75%" },
    { x: box.x + box.width - 36, y: box.y + box.height * 0.5, label: "right-36" },
  ];

  for (const pt of points) {
    const probe = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { ok: false, tag: null, text: null };
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").trim();
      return { ok: true, tag: el.tagName, text: text.slice(0, 30) };
    }, { x: pt.x, y: pt.y });
    writeLog(`[click-probe] elementFromPoint ${pt.label} ${JSON.stringify(probe)}`);

    const clicked = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    }, { x: pt.x, y: pt.y });
    if (clicked) {
      writeLog(`[click-ok] method=elementFromPoint ${pt.label}`);
      await page.waitForTimeout(400);
      return true;
    }

    await page.mouse.click(pt.x, pt.y);
    writeLog(`[click-attempt] mouse ${pt.label}`);
    await page.waitForTimeout(400);
  }
  return false;
}

function readPublishSuccessUrl(page: Page): string | null {
  try {
    const url = page.url();
    return urlIndicatesPublishSuccess(url) ? url : null;
  } catch {
    return null;
  }
}

async function publishClickMaybeSucceeded(page: Page, writeLog: (m: string) => void): Promise<boolean> {
  if (await clickPublishConfirmIfPresent(page, writeLog)) {
    writeLog("[click-effect] publish confirm dialog handled");
    return true;
  }
  const successUrl = readPublishSuccessUrl(page);
  if (successUrl) {
    writeLog(`[click-effect] success url=${successUrl}`);
    return true;
  }
  const url = page.url();
  writeLog(`[click-no-effect] still on publish page url=${url}`);
  return false;
}

/** 点击发布；若已跳到成功页则返回该 URL（无需再等长 settle）。 */
async function clickPublish(page: Page, writeLog: (m: string) => void): Promise<string | null> {
  await withHumanPacing(
    page,
    "click_publish",
    async () => {
      await prepareComposePageBeforePublish(page, writeLog);

      const host = await waitForPublishButtonReady(page, writeLog);
      await probePublishShadow(page, writeLog);
      await host.scrollIntoViewIfNeeded().catch(() => {});

      if (await clickPublishViaShadowLocator(page, writeLog)) {
        await page.waitForTimeout(800);
        if (await publishClickMaybeSucceeded(page, writeLog)) return;
      }

      if (await clickPublishViaElementFromPoint(page, host, writeLog)) {
        await page.waitForTimeout(800);
        if (await publishClickMaybeSucceeded(page, writeLog)) return;
      }

      writeLog("[click-fallback] legacy page-level 发布 selectors");
      await clickAny(page, ["button:has-text('发布')", "div[role='button']:has-text('发布')"], writeLog, 10_000);
      await page.waitForTimeout(800);
      await publishClickMaybeSucceeded(page, writeLog);
    },
    writeLog,
  );

  const immediate = readPublishSuccessUrl(page);
  if (immediate) {
    writeLog(`publish success url after click (skip long settle) url=${immediate}`);
    return immediate;
  }

  await humanWaitAfterPublishClick(page, writeLog, 3000);
  return readPublishSuccessUrl(page);
}

async function clickPublishConfirmIfPresent(page: Page, writeLog: (m: string) => void): Promise<boolean> {
  const selectors = [
    "button:has-text('确认发布')",
    "button:has-text('确认')",
    "button:has-text('继续发布')",
    "button:has-text('仍要发布')",
    "div[role='dialog'] button:has-text('发布')",
  ];
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.waitFor({ state: "visible", timeout: 2500 });
        await locator.click({ timeout: 2500 });
        writeLog(`clicked publish confirm selector=${selector}`);
        await humanWaitAfterPublishClick(page, writeLog);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function detectPublishBlockingMessage(page: Page, writeLog: (m: string) => void): Promise<string | null> {
  const candidates = [
    "请完善",
    "请输入标题",
    "请输入正文",
    "请选择封面",
    "发布失败",
    "内容有误",
    "包含违规",
    "字数",
    "最多",
    "至少",
    "校验失败",
    "网络异常",
  ];
  let bodyText = "";
  try {
    bodyText = (await page.locator("body").innerText({ timeout: 3000 })) ?? "";
  } catch {
    return null;
  }
  for (const text of candidates) {
    if (bodyText.includes(text)) {
      writeLog(`blocking message detected=${text}`);
      return text;
    }
  }
  return null;
}

function urlIndicatesPublishSuccess(url: string): boolean {
  if (url.includes("/publish/success")) return true;
  if (/[?&]published=true(?:&|$)/.test(url)) return true;
  return false;
}

async function waitPublishSuccess(page: Page, writeLog: (m: string) => void): Promise<{ postId: string | null; postUrl: string }> {
  const successTexts = ["发布成功", "发布完成", "笔记发布成功", "笔记已发布"];
  const deadline = Date.now() + 20_000;
  let confirmClicked = false;

  while (Date.now() < deadline) {
    let currentUrl = "";
    try {
      currentUrl = page.url();
    } catch (e) {
      writeLog(`post-publish page.url failed: ${String(e)}`);
      throw new PublishError("Publish success not confirmed (page closed before verification)");
    }

    if (urlIndicatesPublishSuccess(currentUrl)) {
      writeLog(`publish success url detected url=${currentUrl}`);
      return { postId: extractPostId(currentUrl), postUrl: currentUrl };
    }

    let text = "";
    try {
      text = (await page.locator("body").innerText({ timeout: 5000 })) ?? "";
    } catch {
      text = "";
    }

    if (successTexts.some((s) => text.includes(s))) {
      writeLog("publish success text detected");
      return { postId: extractPostId(currentUrl), postUrl: currentUrl };
    }

    if (!confirmClicked) {
      confirmClicked = await clickPublishConfirmIfPresent(page, writeLog);
      if (confirmClicked) {
        try {
          currentUrl = page.url();
          if (urlIndicatesPublishSuccess(currentUrl)) {
            writeLog(`publish success url after confirm url=${currentUrl}`);
            return { postId: extractPostId(currentUrl), postUrl: currentUrl };
          }
        } catch {
          // continue loop
        }
      }
    }

    const blocking = await detectPublishBlockingMessage(page, writeLog);
    if (blocking) throw new PublishError(`Publish blocked by page message: ${blocking}`);

    writeLog(`post-publish current_url=${currentUrl}`);
    await page.waitForTimeout(2000);
  }

  throw new PublishError("Publish success not confirmed");
}

export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const { page, context, assets, artifacts, job, target, options } = ctx;

  const isVideo = options.mode === "video";
  const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);
  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const title = (typeof assets.meta.title === "string" ? assets.meta.title : "").trim();
  const body = assets.caption.trim();
  const tags = normalizeTags(assets.meta.tags);

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const imagePaths = assets.mediaFiles.filter((p) => {
    const ext = path.extname(p).toLowerCase();
    return imageExts.has(ext);
  });
  const videoPaths = assets.mediaFiles.filter((p) => {
    const ext = path.extname(p).toLowerCase();
    return videoExts.has(ext);
  });

  const errors: string[] = [];
  if (!job.publish_id) errors.push("missing publish_id");
  if (!job.task_id) errors.push("missing task_id");
  if (!title) errors.push("missing content.title（小红书需要标题）");
  if (isVideo) {
    if (videoPaths.length === 0) errors.push("video 模式需要至少 1 个本机视频（.mp4 等，job.video 为绝对路径）");
  } else {
    if (!body) errors.push("missing content.body");
    if (imagePaths.length === 0) errors.push("images 必须包含至少一张图片（图文发布）");
  }

  if (errors.length > 0) {
    const msg = errors.join("; ");
    writeLog(`validation failed: ${msg}`);
    return {
      status: "failed",
      platform: "xiaohongshu",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      error: msg,
      artifacts,
    };
  }

  const dryRun = Boolean(job.options?.xhs_dry_run);

  try {
    await ensureOpenShadowRoots(context, writeLog);
    // 发布阶段：只使用既有登录态；不做任何登录
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // 小红书后台首次渲染较慢/会有弹窗遮挡；给一个短轮询避免误判登录态失效
    if (!(await waitForLoggedIn(page, writeLog, 25_000))) {
      const reason = "小红书登录态失效（发布阶段不做登录，请先执行 npm run login -- --platform xiaohongshu）";
      writeLog(reason);
      return {
        status: "auth_expired",
        platform: "xiaohongshu",
        profile: target.profile,
        task_id: job.task_id,
        publish_id: job.publish_id,
        reason,
        artifacts,
      };
    }

    if (isVideo) {
      await gotoVideoPublish(page, writeLog);
      await uploadVideoFile(page, videoPaths[0]!, writeLog);
    } else {
      await gotoImagePublish(page, writeLog);
      await uploadImages(page, imagePaths, writeLog);
    }
    await fillTitle(page, title, writeLog);
    if (body) {
      await fillBody(page, body, writeLog);
    } else {
      writeLog("empty body, skip body fill (video 模式可仅标题+视频)");
    }
    if (!isVideo) {
      await fillTags(page, tags, writeLog);
    } else if (tags.length > 0) {
      await fillTags(page, tags, writeLog);
    }

    if (dryRun) {
      let bodyPreview = "";
      try {
        bodyPreview = ((await page.locator("div[contenteditable='true']").first().innerText({ timeout: 3000 })) ?? "").trim();
      } catch {
        bodyPreview = "";
      }
      writeLog(`dry_run body_preview=${bodyPreview.slice(0, 200)}`);
      return {
        status: "validated",
        platform: "xiaohongshu",
        profile: target.profile,
        task_id: job.task_id,
        publish_id: job.publish_id,
        post_url: page.url(),
        artifacts,
      };
    }

    const successUrlFromClick = await clickPublish(page, writeLog);
    const { postId, postUrl } =
      successUrlFromClick ?
        { postId: extractPostId(successUrlFromClick), postUrl: successUrlFromClick }
      : await waitPublishSuccess(page, writeLog);

    const publishedAt = nowIso();
    const finalPostId = postId ?? `xhs-${job.task_id}`;

    writeLog(`status=published post_id=${finalPostId} submit_url=${postUrl} (note: public note URL pending review)`);

    return {
      status: "published",
      platform: "xiaohongshu",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      published_at: publishedAt,
      ...(postUrl ? { post_url: postUrl } : {}),
      post_id: finalPostId,
      artifacts,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeLog(`publish error: ${msg}`);
    if (e instanceof ManualRequiredError) {
      return {
        status: "manual_required",
        platform: "xiaohongshu",
        profile: target.profile,
        task_id: job.task_id,
        publish_id: job.publish_id,
        error: msg,
        artifacts,
      };
    }
    return {
      status: "failed",
      platform: "xiaohongshu",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      error: msg,
      artifacts,
    };
  }
}
