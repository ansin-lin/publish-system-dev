import { loadSettings } from "../shared/config.js";
import { runLogin } from "../shared/loginRunner.js";
import type { PlatformId } from "../shared/types.js";
import { isPlatformId } from "../shared/types.js";

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
  const settings = loadSettings();

  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "用法：npm run login -- --platform <platform> [--profile default] [--headless false] [--timeout_ms 300000]",
        "",
        "示例：npm run login -- --platform facebook --profile default",
      ].join("\n"),
    );
    process.exit(0);
  }

  const platformRaw = typeof args.platform === "string" ? args.platform.trim() : "";
  if (!platformRaw || !isPlatformId(platformRaw)) {
    throw new Error("必须指定 --platform（x|instagram|facebook|xiaohongshu|youtube|tiktok）");
  }
  const platform: PlatformId = platformRaw;
  const profile = typeof args.profile === "string" && args.profile.trim() ? args.profile.trim() : "default";

  const headless =
    typeof args.headless === "string" ?
      args.headless.trim().toLowerCase() === "true"
      : false; // login 默认必须可见

  const timeoutMs = typeof args.timeout_ms === "string" && args.timeout_ms.trim() ? Number(args.timeout_ms) : 300_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout_ms 必须是正数");

  const result = await runLogin({ settings, platform, profile, headless, timeoutMs });

  // stdout 输出给 OpenClaw
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        platform,
        profile,
        result,
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

