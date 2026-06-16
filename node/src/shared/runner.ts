import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildAssets } from "./assets.js";
import { buildArtifacts, saveResult } from "./artifacts.js";
import { loadAccount } from "./accounts.js";
import { createLogger } from "./logger.js";
import { getPlatformPayload, loadJob } from "./jobLoader.js";
import { ManualRequiredError } from "./errors.js";
import { ensureParentDir, storageStatePath } from "./storage.js";
import { upsertTaskResult } from "./taskResult.js";
import { nowIso } from "./time.js";
import type { JobTarget, PlatformId, PlatformPublisher, PostAssets, PublishMode, PublishResult, Settings } from "./types.js";

function persistentProfileDir(chromeProfilesDir: string, platform: PlatformId, profile: string): string {
  return path.resolve(chromeProfilesDir, platform, profile);
}

async function importPlatformPublisher(platform: PlatformId): Promise<PlatformPublisher> {
  const modulePath = path.resolve("platforms", platform, "publish.ts");
  const url = new URL(`file:///${modulePath.replace(/\\\\/g, "/")}`).toString();
  const mod = await import(url);
  if (typeof (mod as any).publish !== "function") {
    throw new Error(`平台模块必须导出 publish(ctx)：${modulePath}`);
  }
  return (mod as any).publish as PlatformPublisher;
}

export type RunFromJobOptions = {
  /** 若设置，只执行这些 platform（须在 job.targets 里存在）；不传则执行 job 内全部 targets */
  platformFilter?: PlatformId[];
  /** 默认 `post`（图文）；`video` 为仅视频发布，与图文分离 */
  publishMode?: PublishMode;
  /** 覆盖 job.options.headless；未设置时用 job，再无则默认有界面（false） */
  headless?: boolean;
};

function applyPlatformFilter(targets: JobTarget[], filter: PlatformId[] | undefined): JobTarget[] {
  if (!filter || filter.length === 0) return targets;
  const want = new Set(filter);
  return targets.filter((t) => want.has(t.platform));
}

export async function runFromJob(
  settings: Settings,
  jobPath: string,
  runFromJobOptions: RunFromJobOptions = {},
): Promise<PublishResult[]> {
  const { job, jobDir } = loadJob(jobPath);
  const targets = applyPlatformFilter(job.targets, runFromJobOptions.platformFilter);
  if (targets.length === 0) {
    const hint =
      runFromJobOptions.platformFilter?.length ?
        `当前 job.targets 中不包含所选平台：${runFromJobOptions.platformFilter.join(", ")}`
        : "job.targets 为空";
    throw new Error(`没有可发布的平台目标。${hint}`);
  }

  const results: PublishResult[] = [];

  for (const target of targets) {
    const platform = target.platform;
    const profile = target.profile?.trim() ? target.profile.trim() : "default";

    const artifacts = buildArtifacts(settings.artifactsDir, job.task_id, platform, profile);
    const logger = createLogger(artifacts.logPath);

    const defaultPublishMode = runFromJobOptions.publishMode ?? "post";
    const publishMode = target.mode ?? defaultPublishMode;
    const jobRunOpts = {
      headless: runFromJobOptions.headless ?? job.options?.headless ?? false,
      slowMoMs: job.options?.slowmo_ms ?? 0,
      timeoutMs: job.options?.timeout_ms ?? 60_000,
      mode: publishMode,
      requirePostUrl: job.options?.require_post_url ?? true,
      afterPublishClickMs: job.options?.after_publish_click_ms ?? 10_000,
      validationMode: job.options?.validation_mode ?? "balanced",
    };

    const statePath = storageStatePath(settings.storageDir, platform, profile);
    ensureParentDir(statePath);

    logger.info(`开始发布 mode=${publishMode} platform=${platform} profile=${profile} job=${jobPath}`);

    const merged = getPlatformPayload(job, platform);
    if (publishMode === "post") {
      if (!merged.content.body.trim()) {
        const reason = "content.body 为空，按规则跳过该平台发布";
        logger.warn(`跳过 platform=${platform} profile=${profile}：${reason}`);
        const skipped: PublishResult = {
          status: "skipped",
          platform,
          profile,
          task_id: job.task_id,
          publish_id: job.publish_id,
          reason,
          artifacts,
        };
        saveResult(artifacts.resultPath, skipped);
        upsertTaskResult({ artifactsDir: settings.artifactsDir, jobPath, result: skipped });
        results.push(skipped);
        logger.info(`结果已保存: ${artifacts.resultPath}`);
        continue;
      }
    } else {
      const v = merged.video?.trim();
      if (!v) {
        const reason = "video 模式需要 job 中提供非空 video 字段（绝对路径）";
        logger.warn(`跳过 platform=${platform} profile=${profile}：${reason}`);
        const skipped: PublishResult = {
          status: "skipped",
          platform,
          profile,
          task_id: job.task_id,
          publish_id: job.publish_id,
          reason,
          artifacts,
        };
        saveResult(artifacts.resultPath, skipped);
        upsertTaskResult({ artifactsDir: settings.artifactsDir, jobPath, result: skipped });
        results.push(skipped);
        logger.info(`结果已保存: ${artifacts.resultPath}`);
        continue;
      }
      if (!path.isAbsolute(v)) {
        const reason = `video 须为绝对路径: ${v}`;
        logger.warn(`跳过 platform=${platform} profile=${profile}：${reason}`);
        const skipped: PublishResult = {
          status: "skipped",
          platform,
          profile,
          task_id: job.task_id,
          publish_id: job.publish_id,
          reason,
          artifacts,
        };
        saveResult(artifacts.resultPath, skipped);
        upsertTaskResult({ artifactsDir: settings.artifactsDir, jobPath, result: skipped });
        results.push(skipped);
        logger.info(`结果已保存: ${artifacts.resultPath}`);
        continue;
      }
      if (!fs.existsSync(path.resolve(v))) {
        const reason = `视频文件不存在: ${path.resolve(v)}`;
        logger.warn(`跳过 platform=${platform} profile=${profile}：${reason}`);
        const skipped: PublishResult = {
          status: "skipped",
          platform,
          profile,
          task_id: job.task_id,
          publish_id: job.publish_id,
          reason,
          artifacts,
        };
        saveResult(artifacts.resultPath, skipped);
        upsertTaskResult({ artifactsDir: settings.artifactsDir, jobPath, result: skipped });
        results.push(skipped);
        logger.info(`结果已保存: ${artifacts.resultPath}`);
        continue;
      }
    }

    let assets: PostAssets;
    try {
      assets = buildAssets(job, jobDir, platform, settings, publishMode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const failed: PublishResult = {
        status: "failed",
        platform,
        profile,
        task_id: job.task_id,
        publish_id: job.publish_id,
        error: msg,
        artifacts,
      };
      saveResult(artifacts.resultPath, failed);
      upsertTaskResult({ artifactsDir: settings.artifactsDir, jobPath, result: failed });
      results.push(failed);
      logger.error(msg);
      logger.info(`结果已保存: ${artifacts.resultPath}`);
      continue;
    }

    const account = loadAccount(settings.accountsDir, platform, profile);
    const publish = await importPlatformPublisher(platform);

    // X / 小红书 / YouTube / TikTok：真实 Chrome + 持久化 profile（登录更依赖持久 profile）
    const usePersistentChrome =
      platform === "x" || platform === "xiaohongshu" || platform === "youtube" || platform === "tiktok";

    const browser = usePersistentChrome ? null : await chromium.launch({ headless: jobRunOpts.headless, slowMo: jobRunOpts.slowMoMs });
    const context = usePersistentChrome
      ? await chromium.launchPersistentContext(persistentProfileDir(settings.chromeProfilesDir, platform, profile), {
          headless: jobRunOpts.headless,
          slowMo: jobRunOpts.slowMoMs,
          channel: "chrome",
          viewport: null,
          args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
          ignoreDefaultArgs: ["--enable-automation"],
          ...(fs.existsSync(statePath) ? { storageState: statePath } : {}),
        })
      : await browser!.newContext(fs.existsSync(statePath) ? { storageState: statePath } : {});

    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(jobRunOpts.timeoutMs);

    let result: PublishResult;
    try {
      result = await publish({
        page,
        context,
        assets,
        account,
        artifacts,
        job,
        target: { platform, profile },
        options: jobRunOpts,
        settings,
      });
      // 平台层不返回时，给一个保底 published（平台层建议返回详细信息）
      if (!result) {
        result = {
          status: "published",
          platform,
          profile,
          task_id: job.task_id,
          publish_id: job.publish_id,
          published_at: nowIso(),
          artifacts,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = e instanceof ManualRequiredError ? "manual_required" : "failed";
      result = {
        status,
        platform,
        profile,
        task_id: job.task_id,
        publish_id: job.publish_id,
        error: msg,
        artifacts,
      };
      logger.error(msg);
      try {
        await page.screenshot({ path: artifacts.screenshotPath, fullPage: true });
      } catch {}
    } finally {
      try {
        await context.storageState({ path: statePath });
        logger.info(`登录态已保存: ${statePath}`);
      } catch {}
      await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }

    saveResult(artifacts.resultPath, result);
    upsertTaskResult({ artifactsDir: settings.artifactsDir, jobPath, result });
    results.push(result);
    logger.info(`结果已保存: ${artifacts.resultPath}`);
  }

  return results;
}

