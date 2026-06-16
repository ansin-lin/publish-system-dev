import { parsePlatformFilter, parsePublishMode, publishJob, type PublishParams } from "../step7-publish/publish/index.js";

/**
 * 模式 A：命令行入口（OpenClaw 用 exec 调用）。
 *
 * 默认读取 data/tasks/approved/ 下“下一条”任务（按 mtime 升序，其次按文件名）。
 * 允许通过 --job 覆盖（调试或临时任务用）。
 */
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
        "用法：npm run publish -- [--job <path>] [--platforms 平台1,平台2] [--mode post|video]",
        "",
        "  --job <path>        指定 job.json（默认从 data/tasks/approved/ 选取下一条）",
        "  --platforms <list>  只发列出的平台，逗号分隔，例如：x,xiaohongshu",
        "                      不写则按 job.json 里 targets 全部执行",
        "  --mode post|video   默认 post=图文；video=仅发视频（job 中 video 须为绝对路径，与 images 互斥于逻辑）",
        "  --headless          无头模式（默认有界面；也可用 job.options.headless 或 PUBLISH_HEADLESS=1）",
      ].join("\n"),
    );
    process.exit(0);
  }

  const publishParams: PublishParams = {
    publishMode: parsePublishMode(typeof args.mode === "string" ? args.mode : undefined),
    ...(args.headless === true ? { headless: true } : {}),
  };
  if (typeof args.job === "string" && args.job.trim()) {
    publishParams.jobPath = args.job.trim();
  }
  const platformFilter = parsePlatformFilter(typeof args.platforms === "string" ? args.platforms : undefined);
  if (platformFilter !== undefined) {
    publishParams.platformFilter = platformFilter;
  }
  const { jobPath, results } = await publishJob(publishParams);

  // stdout 打印结果 JSON，方便 OpenClaw 直接抓取
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ job_path: jobPath, results }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});

