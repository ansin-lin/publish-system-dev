/**
 * 独立启动 X 发布测试（publish.standalone-test.ts，与生产 publish.ts 隔离）。
 *
 * 用法：
 *   npm run test:x-publish
 *   npm run test:x-publish -- --job ../data/tasks/daily-20260522-r01/publish/publish_job_20260522_r01.json
 *   npm run test:x-publish -- --dry-run
 *   npm run test:x-publish -- --headless
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildAssets } from "../shared/assets.js";
import { buildArtifacts } from "../shared/artifacts.js";
import { loadAccount } from "../shared/accounts.js";
import { loadSettings } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { loadJob } from "../shared/jobLoader.js";
import { resolvePublishHeadless } from "../step7-publish/publish/headless.js";
import { ensureParentDir, storageStatePath } from "../shared/storage.js";
import type { JobJson } from "../shared/types.js";
import { publish as publishXTest } from "../../platforms/x/publish.standalone-test.js";

const DEFAULT_JOB_REL =
  "../data/tasks/daily-20260522-r01/publish/publish_job_20260522_r01.json";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function persistentProfileDir(chromeProfilesDir: string, profile: string): string {
  return path.resolve(chromeProfilesDir, "x", profile);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "用法：npm run test:x-publish -- [options]",
        "",
        "  --job <path>     publish_job.json",
        "  --dry-run        填表+传图后不点 Post",
        "  --headless       无头模式（默认有界面）",
      ].join("\n"),
    );
    process.exit(0);
  }

  const settings = loadSettings();
  const jobRel = typeof args.job === "string" && args.job.trim() ? args.job.trim() : DEFAULT_JOB_REL;
  const jobPath = path.resolve(settings.workspaceDir, jobRel);
  const { job: rawJob, jobDir } = loadJob(jobPath);

  const job: JobJson = {
    ...rawJob,
    options: {
      ...rawJob.options,
      headless: resolvePublishHeadless({
        ...(args.headless === true ? { cliHeadless: true } : {}),
        ...(rawJob.options?.headless !== undefined ? { jobHeadless: rawJob.options.headless } : {}),
      }),
      ...(args["dry-run"] === true ? { x_dry_run: true } : {}),
    },
  };

  const profile = "default";
  const platform = "x" as const;
  const taskId = job.task_id;
  const artifacts = buildArtifacts(settings.artifactsDir, `${taskId}-x-test`, platform, profile);
  const logger = createLogger(artifacts.logPath);
  const statePath = storageStatePath(settings.storageDir, platform, profile);
  ensureParentDir(statePath);

  const headless = job.options?.headless ?? false;
  logger.info(`test:x-publish job=${jobPath} headless=${headless} dry_run=${Boolean(job.options?.x_dry_run)}`);

  const assets = buildAssets(job, jobDir, platform, settings, "post");
  const account = loadAccount(settings.accountsDir, platform, profile);

  const context = await chromium.launchPersistentContext(
    persistentProfileDir(settings.chromeProfilesDir, profile),
    {
      headless,
      channel: "chrome",
      viewport: null,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
      ...(fs.existsSync(statePath) ? { storageState: statePath } : {}),
    },
  );

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(job.options?.timeout_ms ?? 60_000);

  let result: Awaited<ReturnType<typeof publishXTest>>;
  try {
    result = await publishXTest({
      page,
      context,
      assets,
      account,
      artifacts,
      job,
      target: { platform, profile },
      options: {
        headless,
        slowMoMs: 0,
        timeoutMs: job.options?.timeout_ms ?? 60_000,
        mode: "post",
      },
      settings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(msg);
    try {
      await page.screenshot({ path: artifacts.screenshotPath, fullPage: true });
    } catch {
      // ignore
    }
    result = {
      status: "failed",
      platform,
      profile,
      task_id: job.task_id,
      publish_id: job.publish_id,
      error: msg,
      artifacts,
    };
  } finally {
    try {
      await context.storageState({ path: statePath });
    } catch {
      // ignore
    }
    await context.close().catch(() => {});
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: result.status === "published" || result.status === "validated",
        job_path: jobPath,
        log_path: artifacts.logPath,
        screenshot_path: artifacts.screenshotPath,
        result,
      },
      null,
      2,
    ),
  );

  if (result.status !== "published" && result.status !== "validated") {
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
