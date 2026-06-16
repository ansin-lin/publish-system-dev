import { collectTask, type CollectTaskParams } from "../step2-collect/index.js";

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

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "用法：npm run collect -- --task-json <path> [--aggregate-config <path>] [--standalone-config <path>]",
      "",
      "  --task-json <path>           指定 DATA_ROOT/<task_id>/task.json",
      "  --aggregate-config <path>    可选，覆盖 config/collect_aggregate.json",
      "  --standalone-config <path>   可选，覆盖 config/collect_standalone.json",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (typeof args["task-json"] !== "string" || !args["task-json"].trim()) {
    // eslint-disable-next-line no-console
    console.error("缺少必填参数：--task-json <path>");
    printHelp();
    process.exit(1);
  }

  const params: CollectTaskParams = {
    taskJsonPath: args["task-json"].trim(),
  };
  if (typeof args["aggregate-config"] === "string" && args["aggregate-config"].trim()) {
    params.aggregateConfigPath = args["aggregate-config"].trim();
  }
  if (typeof args["standalone-config"] === "string" && args["standalone-config"].trim()) {
    params.standaloneConfigPath = args["standalone-config"].trim();
  }

  const { taskPath, outputPath, result } = await collectTask(params);
  // stdout 打印摘要，方便未来 orchestrator 采集。
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        task_path: taskPath,
        output_path: outputPath,
        ok: result.ok,
        items_count: result.items.length,
        errors_count: result.errors.length,
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
