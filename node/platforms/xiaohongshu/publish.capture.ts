import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";

import type { PublishContext } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";
import { humanStepWait, withHumanPacing } from "../shared/humanDelay.js";

/**
 * 小红书发布 — Playwright 捕获/录制用（勿被 runner 引用）。
 * 打开已登录创作者后台，可选预填图片/标题/正文/话题，然后 page.pause() 供 Inspector 录制新 UI 选择器。
 */
const HOME_URL = "https://creator.xiaohongshu.com/new/home";
const IMAGE_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";

export type XiaohongshuCaptureStep = "home" | "publish_page" | "uploaded" | "filled" | "ready";

export type XiaohongshuCaptureOptions = {
  /** 预填停在哪一步；ready = 文案+图片+话题，停在点「发布」前 */
  step?: XiaohongshuCaptureStep;
  /** 上传图片张数上限（默认 job 内全部） */
  maxImages?: number;
  /** ready 步骤是否跳过话题（避免 tippy 遮挡时先录发布按钮） */
  skipTags?: boolean;
};

function writeLog(artifactsLogPath: string, message: string) {
  const line = `[${nowIso()}] ${message}\n`;
  fs.mkdirSync(path.dirname(artifactsLogPath), { recursive: true });
  fs.appendFileSync(artifactsLogPath, line, "utf-8");
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

async function isLoggedIn(page: Page): Promise<boolean> {
  const checks = [
    (await page.locator("text=发布笔记").count()) > 0,
    (await page.locator("text=上传图文").count()) > 0,
    (await page.locator("text=笔记管理").count()) > 0,
    page.url().includes("creator.xiaohongshu.com") && (await page.locator("text=草稿箱").count()) > 0,
  ];
  return checks.some(Boolean);
}

async function dismissOverlays(page: Page, log: (m: string) => void) {
  const selectors = [
    "button:has-text('我知道了')",
    "button:has-text('知道了')",
    "button:has-text('关闭')",
    "button:has-text('跳过')",
    "button:has-text('暂不')",
    "div[role='button']:has-text('关闭')",
    ".ant-modal-close",
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

/** 关闭 tippy 话题浮层，避免挡住「发布」按钮 */
async function dismissTippyOverlays(page: Page, log: (m: string) => void) {
  for (let i = 0; i < 3; i += 1) {
    try {
      await page.keyboard.press("Escape");
    } catch {
      // ignore
    }
  }
  const tippyRoots = page.locator("[data-tippy-root]");
  const count = Math.min(await tippyRoots.count(), 6);
  for (let i = 0; i < count; i += 1) {
    try {
      const root = tippyRoots.nth(i);
      if (!(await root.isVisible().catch(() => false))) continue;
      log(`tippy root visible index=${i}`);
      await page.keyboard.press("Escape");
      await page.mouse.click(10, 10);
    } catch {
      // ignore
    }
  }
}

async function gotoImagePublish(page: Page, log: (m: string) => void) {
  await page.goto(IMAGE_PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  log(`goto image publish url=${page.url()}`);
  await waitForVisible(page, ["text=上传图片", "text=文字配图", "text=图片编辑"], 30_000);
}

async function uploadImages(page: Page, imagePaths: string[], log: (m: string) => void) {
  await withHumanPacing(
    page,
    "upload_images",
    async () => {
      const fileInputs = ["input[type='file']", "input[accept*='image']"];
      for (const selector of fileInputs) {
        try {
          await page.locator(selector).first().setInputFiles(imagePaths, { timeout: 120_000 });
          log(`uploaded images selector=${selector} count=${imagePaths.length}`);
          await waitForVisible(page, ["text=图片编辑", "text=获取封面建议", "text=笔记预览"], 60_000);
          log("image editor loaded");
          return;
        } catch {
          continue;
        }
      }
      throw new Error("未能上传图片（capture：请手动上传后在 Inspector 中录制）");
    },
    log,
  );
}

async function fillTitle(page: Page, title: string, log: (m: string) => void) {
  await withHumanPacing(
    page,
    "fill_title",
    async () => {
      const selectors = ["input[placeholder*='填写标题']", "input[placeholder*='标题']", "textarea[placeholder*='标题']"];
      const { locator, selector } = await waitForVisible(page, selectors, 20_000);
      await locator.click();
      await locator.fill("");
      await locator.fill(title);
      log(`filled title selector=${selector}`);
    },
    log,
  );
}

function normalizeBodyText(body: string): string {
  let text = String(body ?? "");
  text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
  return text.trim();
}

async function fillBody(page: Page, body: string, log: (m: string) => void) {
  await withHumanPacing(page, "fill_body", async () => {
    const selectors = [
      "[contenteditable='true'][data-placeholder*='正文']",
      "[contenteditable='true'][placeholder*='正文']",
      "div[contenteditable='true']",
      "textarea[placeholder*='输入正文描述']",
      "textarea[placeholder*='正文']",
    ];
    const normalizedBody = normalizeBodyText(body);
    let lastError: unknown;
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: "visible", timeout: 20_000 });
        await locator.click();
        if (selector.startsWith("textarea")) {
          await locator.fill("");
          await locator.fill(normalizedBody);
        } else {
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
          await page.keyboard.insertText(normalizedBody);
          await page.waitForTimeout(500);
        }
        log(`filled body selector=${selector} len=${normalizedBody.length}`);
        return;
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`Could not fill body editor: ${String(lastError)}`);
  }, log);
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

async function clickTopicSuggestion(page: Page, tag: string, log: (m: string) => void): Promise<boolean> {
  const suggestionSelectors = [
    `[role='listbox'] :text('#${tag}')`,
    `[role='option'] :text('#${tag}')`,
    `.ant-select-dropdown :text('#${tag}')`,
    `.ant-popover :text('#${tag}')`,
    `.ant-mentions-dropdown :text('#${tag}')`,
    `.ant-dropdown :text('#${tag}')`,
    `[data-tippy-root] :text('#${tag}')`,
    `div[class*='dropdown'] :text('#${tag}')`,
  ];
  for (const selector of suggestionSelectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.waitFor({ state: "visible", timeout: 1500 });
        await locator.click({ timeout: 1500 });
        log(`clicked topic suggestion selector=${selector}`);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function fillTags(page: Page, tags: string[], log: (m: string) => void) {
  const normalized = normalizeTags(tags);
  if (normalized.length === 0) {
    log("no tags to fill");
    return;
  }

  await humanStepWait(page, log, "fill_tags:before");

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
      log(`selected body editor for tags selector=${selector}`);
      break;
    } catch {
      continue;
    }
  }
  if (!bodyEditor) throw new Error("Could not locate body editor for tags");

  await bodyEditor.click({ timeout: 10_000 });
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  log("moved tags to final line after blank line");

  let selectedCount = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const tag = normalized[index]!;
    try {
      const prefix = index === 0 ? "#" : " #";
      await page.keyboard.insertText(`${prefix}${tag}`);
      await page.waitForTimeout(800);

      if (await clickTopicSuggestion(page, tag, log)) {
        selectedCount += 1;
        await dismissTippyOverlays(page, log);
        continue;
      }

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);

      if (await clickTopicSuggestion(page, tag, log)) {
        selectedCount += 1;
        await dismissTippyOverlays(page, log);
        continue;
      }

      await page.keyboard.press("Control+Z");
      log(`topic suggestion not confirmed, reverted raw text for tag=#${tag}`);
    } catch (e) {
      try {
        await page.keyboard.press("Control+Z");
      } catch {
        // ignore
      }
      log(`topic handling failed for tag=#${tag}: ${String(e)}`);
    }
  }

  log(`filled tags count=${selectedCount}`);
  await dismissTippyOverlays(page, log);
  await humanStepWait(page, log, "fill_tags:after");
}

/** 把当前页面上可见按钮/浮层信息写入日志，便于对照新 UI */
export async function dumpCaptureHints(page: Page, log: (m: string) => void) {
  log(`capture_hints url=${page.url()}`);

  const publishCandidates = [
    () => page.getByRole("button", { name: "发布" }).first(),
    () => page.locator("button:has-text('发布')").first(),
    () => page.locator("div:has-text('发布')").first(),
  ];
  for (let i = 0; i < publishCandidates.length; i += 1) {
    try {
      const loc = publishCandidates[i]!();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        const text = ((await loc.innerText().catch(() => "")) ?? "").trim().slice(0, 80);
        const box = await loc.boundingBox().catch(() => null);
        log(`  publish_candidate[${i}] text=${JSON.stringify(text)} box=${JSON.stringify(box)}`);
      }
    } catch {
      // ignore
    }
  }

  const tippyRoots = page.locator("[data-tippy-root]");
  const tippyCount = Math.min(await tippyRoots.count(), 8);
  log(`capture_hints tippy_roots=${tippyCount}`);
  for (let i = 0; i < tippyCount; i += 1) {
    const root = tippyRoots.nth(i);
    if (!(await root.isVisible().catch(() => false))) continue;
    const text = ((await root.innerText().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    log(`  tippy[${i}] text=${JSON.stringify(text)}`);
  }

  const editors = page.locator("[contenteditable='true'], input[placeholder*='标题'], textarea[placeholder*='标题']");
  const editorCount = Math.min(await editors.count(), 10);
  log(`capture_hints editors=${editorCount}`);
  for (let i = 0; i < editorCount; i += 1) {
    const el = editors.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const placeholder =
      (await el.getAttribute("data-placeholder").catch(() => "")) ??
      (await el.getAttribute("placeholder").catch(() => "")) ??
      "";
    log(`  editor[${i}] placeholder=${JSON.stringify(placeholder)}`);
  }

  const dialogs = page.locator("div[role='dialog'], .ant-modal");
  const dialogCount = Math.min(await dialogs.count(), 6);
  log(`capture_hints dialogs=${dialogCount}`);
  for (let i = 0; i < dialogCount; i += 1) {
    const d = dialogs.nth(i);
    if (!(await d.isVisible().catch(() => false))) continue;
    const text = ((await d.innerText().catch(() => "")) ?? "").trim().replace(/\s+/g, " ").slice(0, 150);
    log(`  dialog[${i}] text=${JSON.stringify(text)}`);
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
  step: XiaohongshuCaptureStep,
  maxImages: number,
  skipTags: boolean,
  log: (m: string) => void,
): Promise<void> {
  if (step === "home") return;

  await gotoImagePublish(page, log);
  if (step === "publish_page") return;

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const images = ctx.assets.mediaFiles
    .filter((p) => imageExts.has(path.extname(p).toLowerCase()))
    .slice(0, Math.max(1, maxImages));

  if (images.length === 0) {
    log("WARN no images in job; skip upload (请手动上传后录制)");
  } else {
    try {
      await uploadImages(page, images, log);
    } catch (e) {
      log(`WARN uploadImages failed: ${String(e)}`);
      if (step === "uploaded") return;
    }
  }
  if (step === "uploaded") return;

  const title = (typeof ctx.assets.meta.title === "string" ? ctx.assets.meta.title : "").trim();
  const body = ctx.assets.caption.trim();
  if (!title) log("WARN job 缺少 content.title，请手动填写标题后录制");

  try {
    if (title) await fillTitle(page, title, log);
  } catch (e) {
    log(`WARN fillTitle failed: ${String(e)}`);
  }

  try {
    if (body) await fillBody(page, body, log);
  } catch (e) {
    log(`WARN fillBody failed: ${String(e)}`);
  }
  if (step === "filled") return;

  const tags = normalizeTags(ctx.assets.meta.tags);
  if (!skipTags && tags.length > 0) {
    try {
      await fillTags(page, tags, log);
    } catch (e) {
      log(`WARN fillTags failed: ${String(e)}`);
    }
  } else if (skipTags) {
    log("skipTags=true：未填话题，便于先录制「发布」按钮选择器");
  }

  await dismissTippyOverlays(page, log);
}

/**
 * 打开小红书创作者后台并暂停，供 Playwright Inspector / codegen 捕获新发布流程。
 */
export async function capturePublish(
  ctx: PublishContext,
  options: XiaohongshuCaptureOptions = {},
): Promise<void> {
  const { page, artifacts, assets } = ctx;
  const log = (m: string) => writeLog(artifacts.logPath, m);
  const step: XiaohongshuCaptureStep = options.step ?? "home";
  const maxImages = options.maxImages ?? assets.mediaFiles.length;
  const skipTags = options.skipTags ?? false;

  log(
    `capture start step=${step} skipTags=${skipTags} title=${JSON.stringify(String(assets.meta.title ?? "").slice(0, 40))} caption_len=${assets.caption.length} images=${assets.mediaFiles.length}`,
  );

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await dismissOverlays(page, log);

  if (!(await isLoggedIn(page))) {
    throw new Error(
      "小红书未登录。请先执行: npm run login -- --platform xiaohongshu --profile default",
    );
  }

  if (step !== "home") {
    await runPrepareStep(page, ctx, step, maxImages, skipTags, log);
  } else {
    log("step=home：已在创作者首页，请手动进入「发布图文」页再录制");
  }

  await dumpCaptureHints(page, log);
  await saveCaptureSnapshot(page, artifacts.runDir, log);

  log(
    "page.pause() — Playwright Inspector 已打开；Resume 继续操作，或从 Record 面板复制新选择器到 platforms/xiaohongshu/publish.ts",
  );
  await page.pause();
}
