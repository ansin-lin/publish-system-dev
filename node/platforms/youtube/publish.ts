import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

const STUDIO_URL = "https://studio.youtube.com/";

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes("accounts.google.com") || url.includes("ServiceLogin")) return false;
    const checks = ["ytcp-app", "ytcp-entity-page", "ytcp-creator-sidebar", "ytcp-button#create-icon"];
    for (const sel of checks) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return true;
    }
    const email = page.locator("input[type='email']").first();
    if ((await email.count()) > 0 && (await email.isVisible().catch(() => false))) return false;
    return false;
  } catch {
    return false;
  }
}

async function waitForLoggedIn(
  page: Page,
  context: BrowserContext,
  writeLog: (m: string) => void,
  timeoutMs = 25_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes("accounts.google.com") || url.includes("ServiceLogin")) {
      writeLog(`detected login redirect url=${url}`);
      return false;
    }

    // cookie 兜底：Google/YouTube 登录后常见 cookie
    try {
      const cookies = [
        ...(await context.cookies("https://studio.youtube.com/")),
        ...(await context.cookies("https://www.youtube.com/")),
      ];
      const names = new Set(cookies.map((c) => c.name));
      const hints = ["SAPISID", "APISID", "SID", "HSID", "SSID", "__Secure-3PAPISID", "__Secure-3PSID", "LOGIN_INFO"];
      if (hints.some((n) => names.has(n))) {
        writeLog(`isLoggedIn=true (cookie hints matched: ${hints.filter((n) => names.has(n)).join(",")})`);
        return true;
      }
    } catch (e) {
      writeLog(`cookie check failed: ${String(e)}`);
    }

    if (await isLoggedIn(page)) return true;
    await page.waitForTimeout(800);
  }
  writeLog(`login check timeout url=${page.url()}`);
  return false;
}

export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const { page, context, assets, artifacts, target, job, options } = ctx;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const longWait = async (label: string, ms = 90_000) => {
    writeLog(`wait ${label} ms=${ms}`);
    await page.waitForTimeout(ms);
  };

  if (options.mode !== "video") {
    return {
      status: "skipped",
      platform: "youtube",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason: "YouTube 仅支持 --mode video（视频上传）；post 图文模式不适用",
      artifacts,
    };
  }

  const videoFile = assets.mediaFiles[0];
  if (!videoFile) throw new Error("YouTube video 模式需要 1 个本机视频文件（job.video 绝对路径）");

  const title = (typeof assets.meta.title === "string" ? assets.meta.title : "").trim();
  const description = assets.caption.trim();
  if (!description) throw new Error("YouTube 需要描述：请在 payloads.youtube.content.body 填写");

  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Studio 页面经常需要额外时间渲染；先等待根节点出现，避免误判与空白页
  try {
    await page.locator("ytcp-app").first().waitFor({ state: "visible", timeout: 60_000 });
    writeLog("studio root visible");
  } catch (e) {
    writeLog(`studio root not visible yet: ${String(e)}`);
  }

  if (!(await waitForLoggedIn(page, context, writeLog, 30_000))) {
    const reason = "YouTube 登录态失效（发布阶段不做登录，请先执行 npm run login -- --platform youtube）";
    writeLog(reason);
    return {
      status: "auth_expired",
      platform: "youtube",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason,
      artifacts,
    };
  }

  // 对齐 codegen：直接点“上传视频”按钮进入上传弹窗
  const uploadEntryNames = [/上传视频/, /Upload videos/i, /動画をアップロード/, /上傳影片/];
  let clickedUploadEntry = false;
  for (const name of uploadEntryNames) {
    try {
      const btn = page.getByRole("button", { name }).first();
      await btn.click({ timeout: 30_000, force: true });
      writeLog(`clicked upload entry name=${String(name)}`);
      clickedUploadEntry = true;
      break;
    } catch {
      continue;
    }
  }
  if (!clickedUploadEntry) {
    // 兜底：若页面没有显式“上传视频”按钮，再尝试旧的 Create->Upload 菜单流程
    writeLog("upload entry button not found; fallback to create menu flow");

    const createSelectors = [
      "ytcp-button#create-icon",
      "#create-icon",
      "tp-yt-paper-icon-button#create-icon",
      "tp-yt-paper-icon-button[aria-label*='Create']",
      "tp-yt-paper-icon-button[aria-label*='作成']",
      "tp-yt-paper-icon-button[aria-label*='创建']",
      "tp-yt-paper-icon-button[aria-label*='建立']",
      "button[aria-label*='Create']",
      "button[aria-label*='创建']",
      "button:has-text('创建')",
      "ytcp-button:has-text('创建')",
    ];
    let clickedCreate = false;
    for (const sel of createSelectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) === 0) continue;
        await loc.click({ timeout: 15_000, force: true });
        writeLog(`clicked create selector=${sel}`);
        clickedCreate = true;
        break;
      } catch {
        continue;
      }
    }
    if (!clickedCreate) {
      try {
        const btn = page.getByRole("button", { name: /Create|作成|作る|作成する|アップロード|创建|建立/i }).first();
        await btn.click({ timeout: 15_000, force: true });
        writeLog("clicked create by role name~=Create/作成");
        clickedCreate = true;
      } catch {
        // ignore
      }
    }
    if (!clickedCreate) throw new Error("找不到 YouTube Studio 的 Create/作成 按钮");

    const uploadMenuSelectors = [
      "tp-yt-paper-item:has-text('Upload videos')",
      "tp-yt-paper-item:has-text('動画をアップロード')",
      "tp-yt-paper-item:has-text('上传视频')",
      "ytd-menu-service-item-renderer:has-text('Upload videos')",
      "ytd-menu-service-item-renderer:has-text('動画をアップロード')",
    ];
    for (const sel of uploadMenuSelectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) === 0) continue;
        await loc.click({ timeout: 15_000, force: true });
        writeLog(`clicked upload menu selector=${sel}`);
        clickedUploadEntry = true;
        break;
      } catch {
        continue;
      }
    }
  }
  if (!clickedUploadEntry) throw new Error("找不到 YouTube Studio 的“上传视频/Upload videos”入口");

  // 对齐 codegen：点“选择文件”按钮触发 filechooser，再 setFiles
  const selectFileBtn = page.getByRole("button", { name: /选择文件|Select files|ファイルを選択/i }).first();
  await selectFileBtn.waitFor({ state: "visible", timeout: 60_000 });
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
  await selectFileBtn.click({ timeout: 30_000, force: true });
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles([videoFile]);
    writeLog(`uploaded video via filechooser file=${videoFile}`);
  } else {
    // 兜底：找 input[type=file]
    const input = page.locator("input[type='file']").first();
    await input.setInputFiles([videoFile], { timeout: 120_000 });
    writeLog(`uploaded video via input[type=file] file=${videoFile}`);
  }

  // YouTube 会对视频做检查/解析，通常需要较长时间后标题/描述等字段才稳定可编辑
  await longWait("after_upload_processing", 90_000);

  const waitAnyVisible = async (selectors: string[], timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    let last: string | null = null;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        try {
          const loc = page.locator(sel).first();
          if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) return sel;
          last = sel;
        } catch {
          last = sel;
        }
      }
      await page.waitForTimeout(800);
    }
    throw new Error(`waitAnyVisible timeout. last=${String(last)}`);
  };

  // 对齐 codegen：标题/描述使用 getByRole 的中文 aria-label
  const titleBoxByRole = page.getByRole("textbox", {
    name: /添加一个可描述你视频的标题|Add a title/i,
  }).first();
  await titleBoxByRole.waitFor({ state: "visible", timeout: 180_000 });
  if (title) {
    await titleBoxByRole.click({ timeout: 20_000, force: true });
    // 视频文件名会默认写入标题，需要全选删除后重新输入
    await titleBoxByRole.press("ControlOrMeta+a");
    await titleBoxByRole.fill(title);
    writeLog("filled title via role textbox");
  } else {
    writeLog("no title provided; keep default filename title");
  }

  const descBoxByRole = page.getByRole("textbox", {
    name: /向观看者介绍你的视频|Tell viewers about your video|Description/i,
  }).first();
  await descBoxByRole.waitFor({ state: "visible", timeout: 60_000 });
  await descBoxByRole.click({ timeout: 20_000, force: true });
  await descBoxByRole.fill(description);
  writeLog("filled description via role textbox");

  // 对齐 codegen：是否面向儿童
  await page.getByRole("radio", { name: /不，内容不是面向儿童的|No, it's not made for kids/i }).click({ timeout: 30_000, force: true });
  writeLog("selected not-made-for-kids via role radio");

  // 对齐 codegen：继续 x3
  const contBtn = page.getByRole("button", { name: /继续|Continue|次へ/i }).first();
  for (let i = 0; i < 3; i += 1) {
    await contBtn.click({ timeout: 60_000, force: true });
    writeLog(`clicked continue(${i + 1})`);
    // 每一页检查/解析可能较慢，给足等待
    await longWait(`after_continue_${i + 1}`, 60_000);
  }

  // 对齐 codegen：选择公开并发布（若你后续要“限定公开”，再加一个 config）
  await page.getByRole("radio", { name: "公开", exact: true }).click({ timeout: 30_000, force: true });
  writeLog("picked visibility=公开");
  await longWait("after_visibility", 60_000);
  await page.getByRole("button", { name: "发布" }).click({ timeout: 60_000, force: true });
  writeLog("clicked 发布");
  await longWait("after_publish_click", 90_000);

  // 发布完成后可能出现“关闭(X)”按钮，也可能自动跳回 Studio 首页；两种都视为成功。
  try {
    const closeBtn = page.locator("#close-icon-button").first();
    if ((await closeBtn.count()) > 0 && (await closeBtn.isVisible().catch(() => false))) {
      await closeBtn.click({ timeout: 120_000, force: true });
      writeLog("clicked close-icon-button");
    } else {
      writeLog("close-icon-button not visible; assume dialog already closed");
    }
  } catch (e) {
    writeLog(`close-icon-button click skipped: ${String(e)}`);
  }
  return {
    status: "published",
    platform: "youtube",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    published_at: nowIso(),
    artifacts,
  };
}

