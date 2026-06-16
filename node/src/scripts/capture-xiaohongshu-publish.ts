/**
 * 小红书发布 Playwright 捕获（Inspector / codegen）。
 *
 * 默认打开已登录 Chrome（与生产 publish 相同 profile + storageState），
 * 在创作者后台暂停，便于重新录制上传、填表、话题、发布等选择器。
 *
 * 用法：
 *   npm run capture:xhs-publish
 *   npm run capture:xhs-publish -- --prepare
 *   npm run capture:xhs-publish -- --step ready --job ../data/tasks/daily-20260615-r03/publish/publish_job_20260615_r03.json
 *   npm run capture:xhs-publish -- --prepare --skip-tags
 *   npm run capture:xhs-publish -- --codegen
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
  type XiaohongshuCaptureStep,
} from "../../platforms/xiaohongshu/publish.capture.js";

const DEFAULT_JOB_REL =
  "../data/tasks/daily-20260615-r03/publish/publish_job_20260615_r03.json";

const VALID_STEPS = new Set<XiaohongshuCaptureStep>([
  "home",
  "publish_page",
  "uploaded",
  "filled",
  "ready",
]);

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
  return path.resolve(chromeProfilesDir, "xiaohongshu", profile);
}

function resolveStep(args: Record<string, string | boolean>): XiaohongshuCaptureStep {
  if (args.prepare === true) return "ready";
  const raw = typeof args.step === "string" ? args.step.trim() : "home";
  if (VALID_STEPS.has(raw as XiaohongshuCaptureStep)) return raw as XiaohongshuCaptureStep;
  throw new Error(`无效 --step=${raw}，可选: home | publish_page | uploaded | filled | ready`);
}

function runCodegen(settings: ReturnType<typeof loadSettings>, profile: string, statePath: string) {
  const profileDir = persistentProfileDir(settings.chromeProfilesDir, profile);
  const outDir = path.resolve(settings.artifactsDir, "xhs-publish-capture");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `codegen-${new Date().toISOString().replace(/[:.]/g, "-")}.ts`);
  const startUrl =
    "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";

  const codegenArgs = [
    "playwright",
    "codegen",
    "--channel=chrome",
    `--user-data-dir=${profileDir}`,
    ...(fs.existsSync(statePath) ? [`--load-storage=${statePath}`] : []),
    "-o",
    outFile,
    startUrl,
  ];

  // eslint-disable-next-line no-console
  console.log(
    [
      "启动 Playwright codegen（独立录屏窗口）",
      `  profile: ${profileDir}`,
      `  storage: ${fs.existsSync(statePath) ? statePath : "(无，需手动登录)"}`,
      `  起始页: ${startUrl}`,
      `  输出: ${outFile}`,
      "",
      "命令: npx " + codegenArgs.join(" "),
      "",
      "注意：若 capture:xhs-publish 的 Chrome 仍开着，请先关闭再 codegen，避免 profile 锁。",
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
        "用法：npm run capture:xhs-publish -- [options]",
        "",
        "  --job <path>       publish_job.json（--prepare / --step 非 home 时用于文案/图片）",
        "  --prepare          等同 --step ready：预填图片+标题+正文+话题，停在点「发布」前 pause",
        "  --step <name>      home | publish_page | uploaded | filled | ready（默认 home）",
        "  --skip-tags        ready/prepare 时跳过话题填写（先录发布按钮，避免 tippy 遮挡）",
        "  --max-images <n>   上传图片张数上限（默认 job 内全部）",
        "  --codegen          用 npx playwright codegen 录脚本（勿与 pause 模式同时开两个 Chrome）",
        "  --slowmo <ms>      慢动作，默认 0",
        "",
        "Inspector 模式（默认）：有界面 Chrome → 创作者后台 → page.pause()",
        "  建议先关闭其它占用 xiaohongshu/default profile 的浏览器窗口。",
        "",
        "产物：logs/task/<task>-xhs-capture/xiaohongshu/default/",
        "  - run.log",
        "  - capture-page.html / capture-page.png（pause 前页面快照）",
      ].join("\n"),
    );
    process.exit(0);
  }

  const settings = loadSettings();
  const profile = "default";
  const platform = "xiaohongshu" as const;
  const statePath = storageStatePath(settings.storageDir, platform, profile);
  ensureParentDir(statePath);

  if (args.codegen === true) {
    runCodegen(settings, profile, statePath);
    return;
  }

  const step = resolveStep(args);
  const skipTags = args["skip-tags"] === true;
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

  const taskId = job?.task_id ?? "xhs-capture";
  const artifacts = buildArtifacts(settings.artifactsDir, `${taskId}-xhs-capture`, platform, profile);
  const logger = createLogger(artifacts.logPath);

  const slowMoMs = typeof args.slowmo === "string" ? Number.parseInt(args.slowmo, 10) : 0;
  const slowMo = Number.isFinite(slowMoMs) && slowMoMs >= 0 ? slowMoMs : 0;
  const maxImages =
    typeof args["max-images"] === "string"
      ? Number.parseInt(args["max-images"], 10)
      : (assets?.mediaFiles.length ?? 4);

  logger.info(`capture:xhs-publish step=${step} skipTags=${skipTags} log=${artifacts.logPath}`);

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
      {
        step,
        maxImages: Number.isFinite(maxImages) && maxImages > 0 ? maxImages : 4,
        skipTags,
      },
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
        skip_tags: skipTags,
        log_path: artifacts.logPath,
        run_dir: artifacts.runDir,
        snapshot_html: path.join(artifacts.runDir, "capture-page.html"),
        snapshot_png: path.join(artifacts.runDir, "capture-page.png"),
        hint: "录制结束后把新选择器同步到 platforms/xiaohongshu/publish.ts",
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
