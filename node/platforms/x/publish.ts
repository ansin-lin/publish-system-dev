import fs from "node:fs";
import path from "node:path";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";
import { xBodyMatchesTimeline } from "../../src/shared/xPostBodyMatch.js";
import { humanStepWait, humanWaitAfterPublishClick, withHumanPacing } from "../shared/humanDelay.js";

const HOME_URL = "https://x.com/home";

/**
 * X 平台发布（生产）。
 * 浏览器操作与 publish.standalone-test.ts 一致：侧栏 Post 弹窗 → Post text → fileInput → tweetButton。
 * 延时、遮罩、登录校验、主页校验为生产逻辑。
 */
export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const { page, assets, artifacts, target, job } = ctx;

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const humanWait = async (label?: string) => humanStepWait(page, writeLog, label);

  const smallScroll = async () => {
    try {
      const down = 200 + Math.floor(Math.random() * 250);
      const up = 60 + Math.floor(Math.random() * 120);
      await page.mouse.wheel(0, down);
      await humanStepWait(page, writeLog, "scroll:down", 800, 1500);
      await page.mouse.wheel(0, -up);
      await humanStepWait(page, writeLog, "scroll:up", 800, 1500);
    } catch {
      // ignore
    }
  };

  const dismissOverlays = async () => {
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
          writeLog(`关闭遮罩/弹窗: ${selector}`);
          await humanWait();
          await loc.click({ timeout: 1500, force: true });
          await humanWait();
          await smallScroll();
        }
      } catch {
        // ignore
      }
    }
  };

  const isLoggedIn = async () => {
    try {
      const url = page.url();
      if (url.includes("login") || url.includes("/i/flow/")) return false;
      const checks = [
        "div[aria-label='Timeline: Your Home Timeline']",
        "a[href='/home']",
        "[data-testid='SideNav_NewTweet_Button']",
      ];
      for (const selector of checks) {
        const loc = page.locator(selector).first();
        if ((await loc.count()) > 0 && (await loc.isVisible())) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const pickImages = (mediaFiles: string[], max = 4): string[] => {
    const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
    return mediaFiles
      .filter((p) => imageExts.has(path.extname(p).toLowerCase()))
      .slice(0, max);
  };

  const pickVideo = (mediaFiles: string[]): string | null => {
    const videoExts = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi"]);
    return mediaFiles.find((p) => videoExts.has(path.extname(p).toLowerCase())) ?? null;
  };

  /** 与 standalone-test 相同的弹窗发帖步骤；步骤间用 humanWait */
  const runModalPublish = async (body: string, mediaPaths: string[]) => {
    await withHumanPacing(
      page,
      "open_composer",
      async () => {
        await page.getByTestId("SideNav_NewTweet_Button").click({ timeout: 30_000 });
        writeLog("clicked SideNav_NewTweet_Button");
      },
      writeLog,
    );

    const postText = page.getByRole("textbox", { name: "Post text" });
    await withHumanPacing(
      page,
      "fill_post_text",
      async () => {
        await postText.click({ timeout: 15_000 });
        await postText.fill(body);
        writeLog(`filled Post text len=${body.length}`);
      },
      writeLog,
    );

    if (mediaPaths.length > 0) {
      await withHumanPacing(
        page,
        "upload_media",
        async () => {
          const fileInput = page.locator('input[data-testid="fileInput"], input[type="file"]').first();
          await fileInput.setInputFiles(mediaPaths, { timeout: 120_000 });
          writeLog(`setInputFiles count=${mediaPaths.length}`);
        },
        writeLog,
      );
      // 上传后多等一会，等缩略图/进度条稳定
      await humanStepWait(page, writeLog, "upload_settle", 4000, 6000);
    }

    const tweetButton = page.getByTestId("tweetButton");
    await tweetButton.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="tweetButton"]');
        return btn && btn.getAttribute("aria-disabled") !== "true" && !btn.hasAttribute("disabled");
      },
      { timeout: 60_000 },
    );

    await withHumanPacing(
      page,
      "click_publish",
      async () => {
        await tweetButton.evaluate((el) => {
          const btn = el as HTMLElement;
          btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
          btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          btn.click();
        });
        writeLog("clicked tweetButton");
      },
      writeLog,
    );
    await humanWaitAfterPublishClick(page, writeLog);
  };

  const getProfileUsername = async () => {
    try {
      const anchors = page.locator("a[href^='/'][role='link']");
      const count = Math.min(await anchors.count(), 80);
      const reserved = new Set(["home", "explore", "notifications", "messages", "compose", "i", "settings", "search"]);
      for (let i = 0; i < count; i += 1) {
        const href = await anchors.nth(i).getAttribute("href");
        if (!href || !href.startsWith("/")) continue;
        const slug = href.replace(/^\/+/, "").split("/")[0] ?? "";
        if (slug && !reserved.has(slug) && !slug.startsWith("hashtag")) return slug;
      }
    } catch {
      return null;
    }
    return null;
  };

  const verifyLatestPost = async (username: string | null, expectedBody: string) => {
    if (!username) return { postUrl: null as string | null, postId: null as string | null, matched: false };
    const expected = expectedBody.trim();
    const profileUrl = `https://x.com/${username}`;
    writeLog(`打开个人主页校验: ${profileUrl}`);

    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await humanWait();
    await smallScroll();
    await dismissOverlays();

    const article = page.locator("article[data-testid='tweet']").first();
    await article.waitFor({ timeout: 30_000 });
    const text = (await article.innerText({ timeout: 5000 })) ?? "";
    const bodyMatched = xBodyMatchesTimeline(expected, text, "balanced");

    const hrefs = article.locator("a[href*='/status/']");
    const hrefCount = Math.min(await hrefs.count(), 10);
    for (let i = 0; i < hrefCount; i += 1) {
      const href = await hrefs.nth(i).getAttribute("href");
      if (!href || !href.includes("/status/")) continue;
      const url = href.startsWith("http") ? href : `https://x.com${href}`;
      const m = url.match(/\/status\/(\d+)/);
      if (m?.[1]) {
        return { postUrl: url, postId: m[1], matched: bodyMatched };
      }
    }
    return { postUrl: null, postId: null, matched: bodyMatched };
  };

  const finishPublished = async (body: string): Promise<PublishResult> => {
    const username = await getProfileUsername();
    const { postUrl, postId, matched } = await verifyLatestPost(username, body);
    writeLog(
      `X 发布完成（校验=${matched}） username=${username ?? "unknown"} post_id=${postId ?? "unknown"} post_url=${postUrl ?? "unknown"}`,
    );
    if (!postId) {
      return {
        status: "failed",
        platform: "x",
        profile: target.profile,
        task_id: job.task_id,
        publish_id: job.publish_id,
        error: matched
          ? "X 发帖后未获取 post_id（时间线未见 /status/ 链接）"
          : "X 发帖后未获取 post_id，且时间线正文未匹配",
        artifacts,
      };
    }
    if (!matched) {
      writeLog("X: post_id 已获取，时间线正文未完全匹配（balanced 仍视为发布成功）");
    }
    return {
      status: "published",
      platform: "x",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      published_at: nowIso(),
      ...(postUrl ? { post_url: postUrl } : {}),
      post_id: postId,
      artifacts,
    };
  };

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await humanWait();
  await smallScroll();
  await dismissOverlays();

  if (!(await isLoggedIn())) {
    const reason = "X 登录态失效（发布阶段不做登录，请先执行 npm run login -- --platform x）";
    writeLog(reason);
    return {
      status: "auth_expired",
      platform: "x",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      reason,
      artifacts,
    };
  }

  const body = assets.caption.trim();

  if (ctx.options.mode === "video") {
    const videoFile = pickVideo(assets.mediaFiles);
    if (!videoFile) {
      throw new Error("X video 模式需要 1 个本机视频（.mp4 等，来自 job 中绝对路径的 video 字段）");
    }
    if (!fs.existsSync(videoFile)) throw new Error(`视频文件不存在: ${videoFile}`);

    await runModalPublish(body || " ", [videoFile]);
    return finishPublished(body);
  }

  if (!body) throw new Error("job.content.body 为空：X 至少需要文案（当前实现不支持空文案发布）");

  const images = pickImages(assets.mediaFiles, 4);
  for (const p of images) {
    if (!fs.existsSync(p)) throw new Error(`图片文件不存在: ${p}`);
  }

  await runModalPublish(body, images);
  return finishPublished(body);
}
