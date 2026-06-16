/**
 * X 发布 Playwright 捕获（Inspector / codegen）。
 *
 * 默认打开已登录 Chrome（与生产 publish 相同 profile + storageState），
 * 在 https://x.com/home 暂停，便于重新录制 Post 按钮、上传、校验等选择器。
 *
 * 用法：
 *   npm run capture:x-publish
 *   npm run capture:x-publish -- --prepare
 *   npm run capture:x-publish -- --job ../data/tasks/daily-20260522-r01/publish/publish_job_20260522_r01.json --prepare
 *   npm run capture:x-publish -- --codegen
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { buildAssets } from "../shared/assets.js";
import { buildArtifacts } from "../shared/artifacts.js";
import { loadAccount } from "../shared/accounts.js";
import { loadSettings } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";
import { loadJob } from "../shared/jobLoader.js";
import { ensureParentDir, storageStatePath } from "../shared/storage.js";
import type { JobJson } from "../shared/types.js";
import { capturePublish } from "../../platforms/x/publish.capture.js";

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

function runCodegen(settings: ReturnType<typeof loadSettings>, profile: string, statePath: string) {
  const profileDir = persistentProfileDir(settings.chromeProfilesDir, profile);
  const outDir = path.resolve(settings.artifactsDir, "x-publish-capture");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `codegen-${new Date().toISOString().replace(/[:.]/g, "-")}.ts`);

  const codegenArgs = [
    "playwright",
    "codegen",
    "--channel=chrome",
    `--user-data-dir=${profileDir}`,
    ...(fs.existsSync(statePath) ? [`--load-storage=${statePath}`] : []),
    `-o`,
    outFile,
    "https://x.com/home",
  ];

  // eslint-disable-next-line no-console
  console.log([
    "启动 Playwright codegen（独立录屏窗口）",
    `  profile: ${profileDir}`,
    `  storage: ${fs.existsSync(statePath) ? statePath : "(无，需手动登录)"}`,
    `  输出: ${outFile}`,
    "",
    "命令: npx " + codegenArgs.join(" "),
    "",
    "注意：若 capture:x-publish 的 Chrome 仍开着，请先关闭再 codegen，避免 profile 锁。",
  ].join("\n"));

  const child = spawn("npx", codegenArgs, {
    stdio: "inherit",
    shell: true,
    cwd: settings.workspaceDir,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "用法：npm run capture:x-publish -- [options]",
        "",
        "  --job <path>       publish_job.json（--prepare 时用于文案/图片）",
        "  --prepare          预填文案+图片，停在点 Post 之前再 pause",
        "  --codegen          用 npx playwright codegen 录脚本（勿与 pause 模式同时开两个 Chrome）",
        "  --slowmo <ms>      慢动作，默认 0",
        "",
        "Inspector 模式（默认）：有界面 Chrome → 首页 → page.pause()",
        "  建议先关闭其它占用 x/default profile 的浏览器窗口。",
      ].join("\n"),
    );
    process.exit(0);
  }

  const settings = loadSettings();
  const profile = "default";
  const platform = "x" as const;
  const statePath = storageStatePath(settings.storageDir, platform, profile);
  ensureParentDir(statePath);

  if (args.codegen === true) {
    runCodegen(settings, profile, statePath);
    return;
  }

  const prepare = args.prepare === true;
  let job: JobJson | null = null;
  let jobDir = settings.workspaceDir;
  let assets: ReturnType<typeof buildAssets> | null = null;

  if (prepare) {
    const jobRel = typeof args.job === "string" && args.job.trim() ? args.job.trim() : DEFAULT_JOB_REL;
    const jobPath = path.resolve(settings.workspaceDir, jobRel);
    const loaded = loadJob(jobPath);
    job = loaded.job;
    jobDir = loaded.jobDir;
    assets = buildAssets(job, jobDir, platform, settings, "post");
  }

  const taskId = job?.task_id ?? "x-capture";
  const artifacts = buildArtifacts(settings.artifactsDir, `${taskId}-x-capture`, platform, profile);
  const logger = createLogger(artifacts.logPath);

  const slowMoMs = typeof args.slowmo === "string" ? Number.parseInt(args.slowmo, 10) : 0;
  const slowMo = Number.isFinite(slowMoMs) && slowMoMs >= 0 ? slowMoMs : 0;

  logger.info(`capture:x-publish prepare=${prepare} log=${artifacts.logPath}`);

  const context = await chromium.launchPersistentContext(
    persistentProfileDir(settings.chromeProfilesDir, profile),
    {
      headless: false,
      slowMo,
      channel: "chrome",
      viewport: null,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
      ...(fs.existsSync(statePath) ? { storageState: statePath } : {}),
    },
  );

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(60_000);

  const account = loadAccount(settings.accountsDir, platform, profile);

  try {
    await capturePublish(
      {
        page,
        context,
        assets: assets ?? {
          baseDir: jobDir,
          caption: "",
          mediaFiles: [],
          mode: "post",
          meta: { source: "capture" },
        },
        account,
        artifacts,
        job: job ?? {
          task_id: taskId,
          publish_id: "capture",
          targets: [{ platform, profile }],
          payloads: { default: { content: { title: "", body: "", tags: [] }, images: [] } },
        },
        target: { platform, profile },
        options: { headless: false, slowMoMs: slowMo, timeoutMs: 60_000, mode: "post" },
        settings,
      },
      { prepare },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(msg);
    try {
      await page.screenshot({ path: artifacts.screenshotPath, fullPage: true });
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exit(1);
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
        ok: true,
        log_path: artifacts.logPath,
        screenshot_path: artifacts.screenshotPath,
        hint: "录制结束后把新选择器同步到 platforms/x/publish.ts",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
