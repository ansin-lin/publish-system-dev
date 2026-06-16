/**
 * 单独发布 Facebook（使用 platforms/facebook/publish.ts，与 runner 一致）。
 *
 * 用法：
 *   npm run test:fb-publish
 *   npm run test:fb-publish -- --job ../data/tasks/daily-20260522-r01/publish/publish_job_20260522_r01.json
 *   npm run test:fb-publish -- --headless
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
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { ensureParentDir, storageStatePath } from "../shared/storage.js";
import type { JobJson } from "../shared/types.js";
import { publish as publishFacebookRouter } from "../../platforms/facebook/publish.js";
import { publishFromHome } from "../../platforms/facebook/publish.home.js";
import { publishFromProfile } from "../../platforms/facebook/publish.profile.js";

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "用法：npm run test:fb-publish -- [options]",
        "",
        "  --job <path>     publish_job.json（默认 daily-20260522-r01）",
        "  --headless       无头模式（默认有界面）",
        "  --slowmo <ms>    慢动作，默认 0",
        "  --entry home|profile  覆盖 step7.facebook.composer_entry",
        "  --profile-link <name>  profile 入口时个人 link 名（覆盖配置）",
        "",
        "等价：npm run publish -- --job <path> --platforms facebook",
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
    },
  };

  const profile = "default";
  const platform = "facebook" as const;
  const taskId = job.task_id;
  const artifacts = buildArtifacts(settings.artifactsDir, `${taskId}-fb-test`, platform, profile);
  const logger = createLogger(artifacts.logPath);
  const statePath = storageStatePath(settings.storageDir, platform, profile);
  ensureParentDir(statePath);

  const headless = job.options?.headless ?? false;
  const slowMoMs = typeof args.slowmo === "string" ? Number.parseInt(args.slowmo, 10) : 0;
  const slowMo = Number.isFinite(slowMoMs) && slowMoMs >= 0 ? slowMoMs : 0;
  const timeoutMs = job.options?.timeout_ms ?? 60_000;

  logger.info(`test:fb-publish job=${jobPath} headless=${headless}`);

  const assets = buildAssets(job, jobDir, platform, settings, "post");
  const account = loadAccount(settings.accountsDir, platform, profile);

  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext(
    fs.existsSync(statePath) ? { storageState: statePath } : {},
  );
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  let result: Awaited<ReturnType<typeof publishFromHome>>;
  const entryRaw = typeof args.entry === "string" ? args.entry.trim().toLowerCase() : "";
  const entry = entryRaw === "profile" ? "profile" : entryRaw === "home" ? "home" : null;
  const orch = loadPublishOrchestratorConfig();
  const configDisplayName = orch.step7.facebook.profile_link_name.trim();
  const profileLinkName =
    typeof args["profile-link"] === "string" && args["profile-link"].trim()
      ? args["profile-link"].trim()
      : configDisplayName || undefined;

  const publishCtx = {
    page,
    context,
    assets,
    account,
    artifacts,
    job,
    target: { platform, profile },
    options: {
      headless,
      slowMoMs: slowMo,
      timeoutMs,
      mode: "post" as const,
    },
    settings,
  };

  try {
    if (entry === "profile") {
      const profileOpts: { profileLinkName?: string } = {};
      if (profileLinkName) profileOpts.profileLinkName = profileLinkName;
      result = await publishFromProfile(publishCtx, profileOpts);
    } else if (entry === "home") {
      const homeOpts: { displayName?: string } = {};
      if (profileLinkName) homeOpts.displayName = profileLinkName;
      result = await publishFromHome(publishCtx, homeOpts);
    } else {
      result = await publishFacebookRouter(publishCtx);
    }
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
    await browser.close().catch(() => {});
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
