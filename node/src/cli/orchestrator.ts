import {
  completeStep4Pick,
  executeStep6,
  executeStep7Publish,
  createTask,
  createOutboxRepo,
  dispatchOnce,
  loadOrchestratorSettings,
  reconcile,
  applyPublishReview,
  regenerateCopyPlatforms,
} from "../orchestrator/index.js";
import {
  materializeCollectForManagerSelectedTask,
  parseIndicesArg,
} from "../step4-approval/materializeSelectedCollect.js";
import { parsePlatformFilter } from "../step7-publish/publish/index.js";
import { ensureDailyTasks } from "../step1-create/ensureDailyTask.js";
import { step4PollPendingPicks } from "../orchestrator/step4PollPendingPicks.js";
import { step7PollSlackRetry } from "../step7-publish/step7SlackRetry.js";
import { taskJsonPath } from "../orchestrator/taskStore.js";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return { command: positional[0] ?? "", args };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "用法：npm run orchestrator -- <command> [options]",
      "",
      "commands:",
      "  init-db                         初始化 SQLite outbox 表",
      "  clear-outbox --yes              删除 outbox_events 全部行并 VACUUM（任务目录已删时用）",
      "  create-task [--task-id id]       创建调试任务并进入 collecting",
      "              [--run-id r01]",
      "  dispatch-once [--limit n]        消费一批 pending outbox 事件",
      "  reconcile                       回收超时 processing 并补偿非终态任务事件",
      "  run-once [--limit n]             先 reconcile，再 dispatch-once",
      "  submit-pick --task-id id         Step4 完整流程：pick → content-research → topic_research",
      "              --raw \"pick 2,5\" [--operator slackUserId|cli:local]",
      "  materialize-collect --task-id id  补写 selected_collect_items（已选题/调研后）",
      "              --indices \"1,3\" 或 --raw \"pick 44\"",
      "  generate-content --task-id id     Step6：topic_research → 文案 + 配图",
      "  generate-images --task-id id      同 generate-content（别名，配图用 @google/genai 时亦用此命令）",
      "  publish-task --task-id id         Step7：copy_result + image_result → publish_job → Playwright 发布",
      "              [--platforms x,instagram]  可选，默认 copy 中四平台全开",
      "              [--headless]              无头模式（默认有界面，可看到浏览器操作）",
      "              [--dry-run]               只生成 publish_job，不打开浏览器发帖",
      "  approve-publish --task-id id          Step6b：确认/驳回发布前文案",
      "              --action approve|reject",
      "  regenerate-copy --task-id id          Step6b：按平台重生文案",
      "              --platforms facebook,x --feedback \"修改说明\"",
    ].join("\n"),
  );
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command || args.help) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const settings = loadOrchestratorSettings();

  if (command === "init-db") {
    const repo = createOutboxRepo(settings);
    try {
      repo.init();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, db_path: settings.dbPath }, null, 2));
    } finally {
      repo.close();
    }
    return;
  }

  if (command === "clear-outbox") {
    if (args.yes !== true) {
      // eslint-disable-next-line no-console
      console.error("clear-outbox 会清空 orchestrator outbox；请传入 --yes 确认。");
      process.exit(1);
    }
    const repo = createOutboxRepo(settings);
    try {
      const deleted = repo.deleteAllEvents();
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, db_path: settings.dbPath, deleted_rows: deleted }, null, 2));
    } finally {
      repo.close();
    }
    return;
  }

  if (command === "create-task") {
    const createParams: Parameters<typeof createTask>[0] = {
      trigger: typeof args.trigger === "string" ? args.trigger : "manual_debug",
      settings,
    };
    if (typeof args["task-id"] === "string") createParams.taskId = args["task-id"];
    if (typeof args["run-id"] === "string") createParams.runId = args["run-id"];
    const created = await createTask(createParams);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(created, null, 2));
    return;
  }

  if (command === "dispatch-once") {
    const limit = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : 10;
    const result = await dispatchOnce({ limit: Number.isFinite(limit) ? limit : 10, settings });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "reconcile") {
    const result = reconcile({ settings });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "run-once") {
    const limit = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : 10;
    const ensureDaily = await ensureDailyTasks(settings);
    const reconcileResult = await reconcile({ settings });
    // Poll Slack picks before dispatch so pick → Step5 can run in the same run-once cycle.
    const step4Poll = await step4PollPendingPicks(settings);
    const dispatchLimit = Number.isFinite(limit) ? limit : 10;
    let dispatchResult = await dispatchOnce({ limit: dispatchLimit, settings });
    if (step4Poll.picks_applied > 0) {
      const reconcileAfterPick = await reconcile({ settings });
      reconcileResult.inserted += reconcileAfterPick.inserted;
      const dispatchAfterPick = await dispatchOnce({ limit: dispatchLimit, settings });
      dispatchResult = {
        claimed: dispatchResult.claimed + dispatchAfterPick.claimed,
        done: dispatchResult.done + dispatchAfterPick.done,
        failed: dispatchResult.failed + dispatchAfterPick.failed,
      };
    }
    const step7RetryPoll = await step7PollSlackRetry(settings);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ensure_daily: ensureDaily,
          reconcile: reconcileResult,
          dispatch: dispatchResult,
          step4_poll: step4Poll,
          step7_retry_poll: step7RetryPoll,
        },
        null,
        2,
      ),
    );
    if (dispatchResult.failed > 0) process.exit(1);
    return;
  }

  if (command === "submit-pick") {
    const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
    if (!taskId) {
      // eslint-disable-next-line no-console
      console.error("submit-pick 需要 --task-id <task_id>");
      process.exit(1);
    }
    const raw = typeof args.raw === "string" ? args.raw : "";
    if (!raw.trim()) {
      // eslint-disable-next-line no-console
      console.error('submit-pick 需要 --raw "pick 2,5"');
      process.exit(1);
    }
    const operator = typeof args.operator === "string" && args.operator.trim() ? args.operator.trim() : "cli:local";
    const tpath = taskJsonPath(settings, taskId);
    const result = await completeStep4Pick({ taskJsonPath: tpath, rawInput: raw, operator, settings });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "generate-content" || command === "generate-images") {
    const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
    if (!taskId) {
      // eslint-disable-next-line no-console
      console.error(`${command} 需要 --task-id <task_id>`);
      process.exit(1);
    }
    const operator = typeof args.operator === "string" && args.operator.trim() ? args.operator.trim() : "cli:local";
    const tpath = taskJsonPath(settings, taskId);
    const result = await executeStep6({ taskJsonPath: tpath, operator, settings });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "publish-task") {
    const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
    if (!taskId) {
      // eslint-disable-next-line no-console
      console.error("publish-task 需要 --task-id <task_id>");
      process.exit(1);
    }
    const operator = typeof args.operator === "string" && args.operator.trim() ? args.operator.trim() : "cli:local";
    const tpath = taskJsonPath(settings, taskId);
    const platformFilter = parsePlatformFilter(typeof args.platforms === "string" ? args.platforms : undefined);
    const result = await executeStep7Publish({
      taskJsonPath: tpath,
      operator,
      settings,
      ...(platformFilter ? { platformFilter } : {}),
      dryRun: args["dry-run"] === true,
      headless: args.headless === true,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "approve-publish") {
    const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
    if (!taskId) {
      // eslint-disable-next-line no-console
      console.error("approve-publish 需要 --task-id <task_id>");
      process.exit(1);
    }
    const actionRaw = typeof args.action === "string" ? args.action.trim().toLowerCase() : "approve";
    if (actionRaw !== "approve" && actionRaw !== "reject") {
      // eslint-disable-next-line no-console
      console.error("approve-publish 需要 --action approve|reject");
      process.exit(1);
    }
    const operator = typeof args.operator === "string" && args.operator.trim() ? args.operator.trim() : "cli:local";
    const tpath = taskJsonPath(settings, taskId);
    const result = await applyPublishReview({
      taskJsonPath: tpath,
      action: actionRaw,
      operator,
      settings,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "regenerate-copy") {
    const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
    if (!taskId) {
      // eslint-disable-next-line no-console
      console.error("regenerate-copy 需要 --task-id <task_id>");
      process.exit(1);
    }
    const platformsRaw = typeof args.platforms === "string" ? args.platforms.trim() : "";
    const feedback = typeof args.feedback === "string" ? args.feedback.trim() : "";
    if (!platformsRaw) {
      // eslint-disable-next-line no-console
      console.error("regenerate-copy 需要 --platforms facebook,x");
      process.exit(1);
    }
    if (!feedback) {
      // eslint-disable-next-line no-console
      console.error('regenerate-copy 需要 --feedback "修改说明"');
      process.exit(1);
    }
    const platforms = platformsRaw.split(/[,，\s]+/).map((p) => p.trim()).filter(Boolean);
    const operator = typeof args.operator === "string" && args.operator.trim() ? args.operator.trim() : "cli:local";
    const tpath = taskJsonPath(settings, taskId);
    const result = await regenerateCopyPlatforms({
      taskJsonPath: tpath,
      platforms,
      feedback,
      operator,
      settings,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "materialize-collect") {
    const taskId = typeof args["task-id"] === "string" ? args["task-id"].trim() : "";
    if (!taskId) {
      // eslint-disable-next-line no-console
      console.error("materialize-collect 需要 --task-id <task_id>");
      process.exit(1);
    }
    const rawIndices =
      typeof args.indices === "string" && args.indices.trim() ?
        args.indices.trim()
      : typeof args.raw === "string" && args.raw.trim() ?
        args.raw.trim()
      : "";
    if (!rawIndices) {
      // eslint-disable-next-line no-console
      console.error('materialize-collect 需要 --indices "1,3" 或 --raw "pick 44"');
      process.exit(1);
    }
    const indices = parseIndicesArg(rawIndices);
    const tpath = taskJsonPath(settings, taskId);
    const result = await materializeCollectForManagerSelectedTask({
      taskJsonPath: tpath,
      indices,
      settings,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  // eslint-disable-next-line no-console
  console.error(`未知 command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
