/**
 * Facebook 发布 Playwright 捕获（Inspector / codegen）。
 *
 * 默认打开已登录 Chrome（与生产 publish 相同 profile + storageState），
 * 在 https://www.facebook.com/ 暂停，便于重新录制发帖对话框、上传、投稿等选择器。
 *
 * 用法：
 *   npm run capture:fb-publish
 *   npm run capture:fb-publish -- --prepare
 *   npm run capture:fb-publish -- --step ready --job ../data/tasks/daily-20260615-r03/publish/publish_job_20260615_r03.json
 *   npm run capture:fb-publish -- --codegen
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
import {
  capturePublish,
  type FacebookCaptureStep,
} from "../../platforms/facebook/publish.capture.js";

const DEFAULT_JOB_REL =
  "../data/tasks/daily-20260615-r03/publish/publish_job_20260615_r03.json";

const VALID_STEPS = new Set<FacebookCaptureStep>(["home", "composer", "filled", "uploaded", "ready"]);

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
  return path.resolve(chromeProfilesDir, "facebook", profile);
}

function resolveStep(args: Record<string, string | boolean>): FacebookCaptureStep {
  if (args.prepare === true) return "ready";
  const raw = typeof args.step === "string" ? args.step.trim() : "home";
  if (VALID_STEPS.has(raw as FacebookCaptureStep)) return raw as FacebookCaptureStep;
  throw new Error(`无效 --step=${raw}，可选: home | composer | filled | uploaded | ready`);
}

function runCodegen(settings: ReturnType<typeof loadSettings>, profile: string, statePath: string) {
  const profileDir = persistentProfileDir(settings.chromeProfilesDir, profile);
  const outDir = path.resolve(settings.artifactsDir, "fb-publish-capture");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `codegen-${new Date().toISOString().replace(/[:.]/g, "-")}.ts`);

  const codegenArgs = [
    "playwright",
    "codegen",
    "--channel=chrome",
    `--user-data-dir=${profileDir}`,
    ...(fs.existsSync(statePath) ? [`--load-storage=${statePath}`] : []),
    "-o",
    outFile,
    "https://www.facebook.com/",
  ];

  // eslint-disable-next-line no-console
  console.log(
    [
      "启动 Playwright codegen（独立录屏窗口）",
      `  profile: ${profileDir}`,
      `  storage: ${fs.existsSync(statePath) ? statePath : "(无，需手动登录)"}`,
      `  输出: ${outFile}`,
      "",
      "命令: npx " + codegenArgs.join(" "),
      "",
      "注意：若 capture:fb-publish 的 Chrome 仍开着，请先关闭再 codegen，避免 profile 锁。",
    ].join("\n"),
  );

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
        "用法：npm run capture:fb-publish -- [options]",
        "",
        "  --job <path>       publish_job.json（--prepare / --step 非 home 时用于文案/图片）",
        "  --prepare          等同 --step ready：预填文案+图片+隐私，停在点「投稿」前 pause",
        "  --step <name>      home | composer | filled | uploaded | ready（默认 home）",
        "  --entry home|profile  捕获哪套入口（默认 home）",
        "  --profile-link <name>  entry=profile 时个人 link 名",
        "  --max-images <n>   上传图片张数上限（默认 job 内全部）",
        "  --codegen          用 npx playwright codegen 录脚本（勿与 pause 模式同时开两个 Chrome）",
        "  --slowmo <ms>      慢动作，默认 0",
        "",
        "Inspector 模式（默认）：有界面 Chrome → 首页 → page.pause()",
        "  建议先关闭其它占用 facebook/default profile 的浏览器窗口。",
        "",
        "产物：logs/task/<task>-fb-capture/facebook/default/",
        "  - run.log",
        "  - capture-page.html / capture-page.png（pause 前页面快照）",
      ].join("\n"),
    );
    process.exit(0);
  }

  const settings = loadSettings();
  const profile = "default";
  const platform = "facebook" as const;
  const statePath = storageStatePath(settings.storageDir, platform, profile);
  ensureParentDir(statePath);

  if (args.codegen === true) {
    runCodegen(settings, profile, statePath);
    return;
  }

  const step = resolveStep(args);
  const entryRaw = typeof args.entry === "string" ? args.entry.trim().toLowerCase() : "home";
  const entry = entryRaw === "profile" ? "profile" : "home";
  const profileLinkName =
    typeof args["profile-link"] === "string" && args["profile-link"].trim()
      ? args["profile-link"].trim()
      : undefined;
  const needsJob = step !== "home";

  let job: JobJson | null = null;
  let jobDir = settings.workspaceDir;
  let assets: ReturnType<typeof buildAssets> | null = null;

  if (needsJob) {
    const jobRel = typeof args.job === "string" && args.job.trim() ? args.job.trim() : DEFAULT_JOB_REL;
    const jobPath = path.resolve(settings.workspaceDir, jobRel);
    const loaded = loadJob(jobPath);
    job = loaded.job;
    jobDir = loaded.jobDir;
    assets = buildAssets(job, jobDir, platform, settings, "post");
  }

  const taskId = job?.task_id ?? "fb-capture";
  const artifacts = buildArtifacts(settings.artifactsDir, `${taskId}-fb-capture`, platform, profile);
  const logger = createLogger(artifacts.logPath);

  const slowMoMs = typeof args.slowmo === "string" ? Number.parseInt(args.slowmo, 10) : 0;
  const slowMo = Number.isFinite(slowMoMs) && slowMoMs >= 0 ? slowMoMs : 0;
  const maxImages =
    typeof args["max-images"] === "string" ? Number.parseInt(args["max-images"], 10) : assets?.mediaFiles.length ?? 4;

  logger.info(`capture:fb-publish step=${step} entry=${entry} log=${artifacts.logPath}`);

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
  page.setDefaultTimeout(90_000);

  const account = loadAccount(settings.accountsDir, platform, profile);

  try {
    const captureOpts: {
      step: typeof step;
      maxImages: number;
      entry: typeof entry;
      profileLinkName?: string;
    } = { step, maxImages: Number.isFinite(maxImages) && maxImages > 0 ? maxImages : 4, entry };
    if (profileLinkName) captureOpts.profileLinkName = profileLinkName;
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
        options: { headless: false, slowMoMs: slowMo, timeoutMs: 90_000, mode: "post" },
        settings,
      },
      captureOpts,
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
        step,
        log_path: artifacts.logPath,
        run_dir: artifacts.runDir,
        snapshot_html: path.join(artifacts.runDir, "capture-page.html"),
        snapshot_png: path.join(artifacts.runDir, "capture-page.png"),
        hint: "录制结束后把新选择器同步到 platforms/facebook/publish.ts",
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
