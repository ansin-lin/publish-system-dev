import fs from "node:fs";
import path from "node:path";

import type { PublishContext, PublishResult } from "../../src/shared/types.js";
import { nowIso } from "../../src/shared/time.js";

/**
 * X 发布 — 独立测试（勿被 runner 引用）。
 * 对齐 codegen 录制：侧栏发帖 → Post text → 图片 → tweetButton
 *
 * 启动：npm run test:x-publish
 */
const HOME_URL = "https://x.com/home";

export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const { page, assets, artifacts, target, job } = ctx;
  const dryRun = Boolean(job.options?.x_dry_run);

  const writeLog = (message: string) => {
    const line = `[${nowIso()}] ${message}\n`;
    fs.mkdirSync(path.dirname(artifacts.logPath), { recursive: true });
    fs.appendFileSync(artifacts.logPath, line, "utf-8");
  };

  const body = assets.caption.trim();
  if (!body) throw new Error("content.body 为空");

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const images = assets.mediaFiles
    .filter((p) => imageExts.has(path.extname(p).toLowerCase()))
    .slice(0, 4);
  for (const p of images) {
    if (!fs.existsSync(p)) throw new Error(`图片不存在: ${p}`);
  }

  writeLog(`x-publish-test(modal) dry_run=${dryRun} body_len=${body.length} images=${images.length}`);

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  await page.getByTestId("SideNav_NewTweet_Button").click({ timeout: 30_000 });
  writeLog("clicked SideNav_NewTweet_Button");

  const postText = page.getByRole("textbox", { name: "Post text" });
  await postText.click({ timeout: 15_000 });
  await postText.fill(body);
  writeLog("filled Post text");

  if (images.length > 0) {
    const fileInput = page.locator('input[data-testid="fileInput"], input[type="file"]').first();
    console.log("fileInput", await fileInput.innerHTML(), "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh");
    await fileInput.setInputFiles(images, { timeout: 120_000 });

    writeLog(`setInputFiles count=${images.length}`);
    await page.waitForTimeout(5000);
  }

  if (dryRun) {
    writeLog("dry_run: 跳过 tweetButton");
    return {
      status: "validated",
      platform: "x",
      profile: target.profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      artifacts,
    };
  }
  const tweetButton = page.getByTestId("tweetButton");

  await tweetButton.waitFor({ state: "visible", timeout: 30_000 });

  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="tweetButton"]');
    return btn && btn.getAttribute("aria-disabled") !== "true" && !btn.hasAttribute("disabled");
  }, { timeout: 60_000 });

  // 方式1：绕过遮罩，直接触发按钮事件
  await tweetButton.evaluate((el) => {
    const btn = el as HTMLElement;
    console.log("btn",btn, "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii");
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    btn.click();
  });

  await page.waitForTimeout(3000);
  writeLog("clicked tweetButton");
  await page.waitForTimeout(3000);

  return {
    status: "published",
    platform: "x",
    profile: target.profile,
    task_id: job.task_id,
    publish_id: job.publish_id,
    published_at: nowIso(),
    artifacts,
  };
}
