import fs from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../shared/config.js";
import { applyEnvOverrides } from "./envOverrides.js";

export const SUPPORTED_SCHEMA_VERSION = "publish-orchestrator-config.v1";
export const SUPPORTED_CONFIG_VERSION = 1;

const TOP_LEVEL_KEYS = new Set([
  "$comment",
  "schema_version",
  "config_version",
  "strict",
  "timezone",
  "instance_name",
  "paths",
  "orchestrator",
  "slack",
  "platforms",
  "step1",
  "step2",
  "step4",
  "step5",
  "step6",
  "step7",
]);

/** Config file values; runtime resolves legacy role/auto/direct → node via step4Delivery.ts */
export type Step4DeliveryMode = "node" | "dry_run" | "direct" | "role" | "auto";

export type Step4PickReceiveMode = "poll" | "off";

export type Step4PickReceiveReplies = {
  success: string;
  custom_success: string;
  already_selected: string;
  invalid_pick: string;
  custom_invalid: string;
  unauthorized: string;
  out_of_range: string;
};

export type Step4PickReceiveConfig = {
  mode: Step4PickReceiveMode;
  poll_on: "run-once";
  pick_timeout_hours: number;
  replies: Step4PickReceiveReplies;
};

const DEFAULT_STEP4_PICK_REPLIES: Step4PickReceiveReplies = {
  success: "今日话题已选择，系统将自动进入调研与写稿。",
  custom_success: "自定义话题已创建，系统将自动进入调研与写稿。",
  already_selected: "今日话题已选择",
  invalid_pick: "格式有误，请在本线程回复：pick 2,5,8",
  custom_invalid: "格式有误，请在本线程回复：title 你想要的自定义话题（建议 8~120 字）",
  unauthorized: "无选题权限。",
  out_of_range: "编号超出候选范围，请对照上方列表。",
};

export type Step7RetryReceiveConfig = {
  mode: "off" | "poll";
  poll_on: "run-once";
  /** step7 = Step7 完成通知帖线程（无则回退 step4）；step4 = 仅选题帖 */
  thread_source: "step7" | "step4";
  replies: {
    success: string;
    invalid: string;
    unauthorized: string;
    max_attempts: string;
    error: string;
  };
};

const DEFAULT_STEP7_RETRY_REPLIES: Step7RetryReceiveConfig["replies"] = {
  success: "已触发 Step7 重试：{platforms}",
  invalid: "格式有误，请在 Step7 发布完成通知下回复：retry instagram 或 retry x,facebook",
  unauthorized: "无发布重试权限。",
  max_attempts: "该平台已达最大重试次数，或无需重试。",
  error: "Step7 重试失败",
};

export type PlatformCopyLimits = {
  titleMax?: number;
  bodyMax: number;
  label: string;
  locale: string;
};

export type PublishOrchestratorConfig = {
  schema_version: string;
  config_version: number;
  strict: boolean;
  timezone: string;
  instance_name: string;
  configDir: string;
  configPath: string;
  repoRoot: string;
  paths: {
    data_dir: string;
    tasks_dir: string;
    db_path: string;
    auth_dir: string;
    assets_img_dir: string;
    assets_video_dir: string;
    temp_dir: string;
    logs_dir: string;
    logs_task_dir: string;
    logs_publish_dir: string;
    logs_jobs_dir: string;
    system_log: string;
    node_dir: string;
  };
  orchestrator: {
    dispatch: { batch_limit: number };
    reconcile: { processing_timeout_ms: number };
    stale: {
      default_threshold_ms: number;
      threshold_ms_by_step: Record<string, number>;
      max_rollbacks_per_step_per_day: number;
      excluded_task_statuses: string[];
    };
  };
  slack: {
    channel_id: string;
    allowed_user_ids: string[];
    step4: {
      delivery: Step4DeliveryMode;
      dry_run: boolean;
      max_candidates_in_message: number;
      pick_receive: Step4PickReceiveConfig;
    };
    step_completion: {
      enabled: boolean;
      dry_run: boolean;
    };
    step7?: {
      retry_receive: Step7RetryReceiveConfig;
    };
  };
  platforms: {
    copy_required: string[];
    publish_enabled: string[];
    definitions: Record<
      string,
      {
        label: string;
        enabled: boolean;
        aliases: string[];
        copy: { enabled: boolean; locale: string; title_max?: number; body_max: number };
        publish: { enabled: boolean; profile: string };
        capabilities: {
          title: boolean;
          tags: boolean;
          images: boolean;
          video: boolean;
        };
        rate_limit_hint: string | null;
      }
    >;
  };
  step1: {
    default_run_id: string;
    default_trigger: string;
    task_id_date_format: string;
    ensure_daily: {
      enabled: boolean;
      /** Legacy fallback when `runs` is empty — only `default_run_id`. */
      not_before_hour: number;
      grace_hours: number;
      runs: Array<{
        run_id: string;
        start_hour: number;
        end_hour: number;
      }>;
    };
  };
  step2: {
    aggregate_config_path: string;
    standalone_config_path: string;
    tophub_channels_path: string;
    allow_partial_success_continue: boolean;
  };
  step4: {
    pick_advance_pipeline_default: boolean;
    materialize_collect_default: boolean;
  };
  step5: {
    skip_if_research_exists: boolean;
  };
  step6: {
    copy: {
      require_all_copy_required_platforms: boolean;
      image_prompt_slot_count: number;
      image_prompt_aspect_ratio: string;
    };
    image: {
      delivery: "node" | "role";
      model: string;
      max_slots: number;
      require_all_slots: boolean;
      prompt_only_on_failure: boolean;
      stock: {
        enabled: boolean;
        priority: Array<"today" | "common" | "ai">;
        today_dir_date_format: string;
        common_dir_name: string;
        extensions: string[];
        max_pick: number;
        force_ai: boolean;
      };
    };
  };
  step7: {
    headless: boolean;
    dry_run: boolean;
    xhs_dry_run: boolean;
    retry_step7_enabled: boolean;
    validation: {
      /** @deprecated prefer mode */
      strict: boolean;
      mode: "strict" | "balanced" | "loose";
      /** false：发帖成功但未抓到 post_url 时返回 validated 而非 failed */
      require_post_url: boolean;
    };
    partial_retry: {
      enabled: boolean;
      max_attempts_per_platform: number;
      auto_on_run_once: boolean;
    };
    timeout_ms: number;
    video: {
      stock: {
        enabled: boolean;
        priority: Array<"today" | "common">;
        today_dir_date_format: string;
        common_dir_name: string;
        extensions: string[];
        max_pick: number;
      };
    };
    human_delay: {
      step_min_ms: number;
      step_max_ms: number;
      after_publish_click_ms: number;
    };
    facebook: {
      /** home=首页 feed composer；profile=个人主页 composer */
      composer_entry: "home" | "profile";
      /** composer_entry=profile 时侧边栏个人 link 可见名 */
      profile_link_name: string;
    };
  };
};

let cached: PublishOrchestratorConfig | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveRepoPath(repoRoot: string, raw: string): string {
  const value = raw.trim();
  if (!value) return repoRoot;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function strList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((x) => String(x).trim()).filter(Boolean);
}

function checkStrictKeys(obj: Record<string, unknown>, allowed: Set<string>, label: string, strict: boolean): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      const msg = `Unknown key in ${label}: ${key}`;
      if (strict) throw new Error(msg);
      // eslint-disable-next-line no-console
      console.warn(`[publish.orchestrator] ${msg}`);
    }
  }
}

function parseConfig(raw: Record<string, unknown>, configPath: string, repoRoot: string): PublishOrchestratorConfig {
  const strict = bool(raw.strict, true);
  checkStrictKeys(raw, TOP_LEVEL_KEYS, "publish.orchestrator root", strict);

  const schema = str(raw.schema_version, "");
  if (schema !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema_version: ${schema} (expected ${SUPPORTED_SCHEMA_VERSION})`,
    );
  }

  const configVersion = typeof raw.config_version === "number" ? raw.config_version : 0;
  if (configVersion > SUPPORTED_CONFIG_VERSION) {
    // eslint-disable-next-line no-console
    console.warn(
      `[publish.orchestrator] config_version ${configVersion} is newer than supported ${SUPPORTED_CONFIG_VERSION}; continue with best-effort parse`,
    );
  }

  const pathsRaw = isObject(raw.paths) ? raw.paths : {};
  const orchRaw = isObject(raw.orchestrator) ? raw.orchestrator : {};
  const dispatchRaw = isObject(orchRaw.dispatch) ? orchRaw.dispatch : {};
  const reconcileRaw = isObject(orchRaw.reconcile) ? orchRaw.reconcile : {};
  const staleRaw = isObject(orchRaw.stale) ? orchRaw.stale : {};
  const staleByStepRaw = isObject(staleRaw.threshold_ms_by_step) ? staleRaw.threshold_ms_by_step : {};

  const slackRaw = isObject(raw.slack) ? raw.slack : {};
  const step4SlackRaw = isObject(slackRaw.step4) ? slackRaw.step4 : {};
  const stepCompletionRaw = isObject(slackRaw.step_completion) ? slackRaw.step_completion : {};

  const platformsRaw = isObject(raw.platforms) ? raw.platforms : {};
  const definitionsRaw = isObject(platformsRaw.definitions) ? platformsRaw.definitions : {};

  const definitions: PublishOrchestratorConfig["platforms"]["definitions"] = {};
  for (const [id, defRaw] of Object.entries(definitionsRaw)) {
    if (!isObject(defRaw)) continue;
    const copyRaw = isObject(defRaw.copy) ? defRaw.copy : {};
    const publishRaw = isObject(defRaw.publish) ? defRaw.publish : {};
    const capRaw = isObject(defRaw.capabilities) ? defRaw.capabilities : {};
    definitions[id] = {
      label: str(defRaw.label, id),
      enabled: bool(defRaw.enabled, true),
      aliases: strList(defRaw.aliases, []),
      copy: {
        enabled: bool(copyRaw.enabled, true),
        locale: str(copyRaw.locale, "zh-CN"),
        ...(typeof copyRaw.title_max === "number" ? { title_max: copyRaw.title_max } : {}),
        body_max: num(copyRaw.body_max, 10_000),
      },
      publish: {
        enabled: bool(publishRaw.enabled, true),
        profile: str(publishRaw.profile, "default"),
      },
      capabilities: {
        title: bool(capRaw.title, false),
        tags: bool(capRaw.tags, false),
        images: bool(capRaw.images, true),
        video: bool(capRaw.video, false),
      },
      rate_limit_hint:
        typeof defRaw.rate_limit_hint === "string" ? defRaw.rate_limit_hint
        : defRaw.rate_limit_hint === null ? null
        : null,
    };
  }

  const copyRequired = strList(platformsRaw.copy_required, ["xiaohongshu", "facebook", "x", "instagram"]);
  const publishEnabled = strList(
    platformsRaw.publish_enabled,
    copyRequired,
  );

  for (const id of copyRequired) {
    if (!definitions[id]) {
      throw new Error(`platforms.copy_required references unknown platform: ${id}`);
    }
    if (!definitions[id]!.copy.enabled) {
      throw new Error(`platforms.copy_required platform ${id} has copy.enabled=false`);
    }
  }
  for (const id of publishEnabled) {
    if (!definitions[id]) {
      throw new Error(`platforms.publish_enabled references unknown platform: ${id}`);
    }
  }

  const step1Raw = isObject(raw.step1) ? raw.step1 : {};
  const step1EnsureRaw = isObject(step1Raw.ensure_daily) ? step1Raw.ensure_daily : {};
  const step1EnsureRunsRaw = Array.isArray(step1EnsureRaw.runs) ? step1EnsureRaw.runs : [];
  const step1EnsureRuns = step1EnsureRunsRaw
    .filter(isObject)
    .map((runRaw) => ({
      run_id: str(runRaw.run_id, "").trim(),
      start_hour: Math.min(23, Math.max(0, num(runRaw.start_hour, 0))),
      end_hour: Math.min(24, Math.max(1, num(runRaw.end_hour, 24))),
    }))
    .filter((run) => run.run_id.length > 0 && run.end_hour > run.start_hour);
  const step2Raw = isObject(raw.step2) ? raw.step2 : {};
  const step4Raw = isObject(raw.step4) ? raw.step4 : {};
  const step5Raw = isObject(raw.step5) ? raw.step5 : {};
  const step6Raw = isObject(raw.step6) ? raw.step6 : {};
  const step6CopyRaw = isObject(step6Raw.copy) ? step6Raw.copy : {};
  const step6ImageRaw = isObject(step6Raw.image) ? step6Raw.image : {};
  const step6StockRaw = isObject(step6ImageRaw.stock) ? step6ImageRaw.stock : {};
  const step7Raw = isObject(raw.step7) ? raw.step7 : {};
  const step7ValidationRaw = isObject(step7Raw.validation) ? step7Raw.validation : {};
  const step7PartialRaw = isObject(step7Raw.partial_retry) ? step7Raw.partial_retry : {};
  const slackStep7Raw = isObject(slackRaw.step7) ? slackRaw.step7 : {};
  const step7RetryRecvRaw = isObject(slackStep7Raw.retry_receive) ? slackStep7Raw.retry_receive : {};
  const step7RetryRepliesRaw = isObject(step7RetryRecvRaw.replies) ? step7RetryRecvRaw.replies : {};
  const step7DelayRaw = isObject(step7Raw.human_delay) ? step7Raw.human_delay : {};
  const step7FacebookRaw = isObject(step7Raw.facebook) ? step7Raw.facebook : {};
  const step7VideoRaw = isObject(step7Raw.video) ? step7Raw.video : {};
  const step7VideoStockRaw = isObject(step7VideoRaw.stock) ? step7VideoRaw.stock : {};
  const step7ValidationMode: "strict" | "balanced" | "loose" = (() => {
    const raw = str(step7ValidationRaw.mode, "").toLowerCase();
    if (raw === "strict" || raw === "balanced" || raw === "loose") return raw;
    return bool(step7ValidationRaw.strict, true) ? "strict" : "balanced";
  })();
  const step7RequirePostUrl =
    step7ValidationRaw.require_post_url !== undefined ?
      bool(step7ValidationRaw.require_post_url, true)
    : step7ValidationMode === "strict";
  const step7FacebookEntryRaw = str(step7FacebookRaw.composer_entry, "home").toLowerCase();
  const step7FacebookComposerEntry: "home" | "profile" =
    step7FacebookEntryRaw === "profile" ? "profile" : "home";
  const videoStockPriority = strList(step7VideoStockRaw.priority, ["today", "common"]).filter(
    (p): p is "today" | "common" => p === "today" || p === "common",
  );

  const dataDir = resolveRepoPath(repoRoot, str(pathsRaw.data_dir, "./data"));

  const staleByStep: Record<string, number> = {};
  for (const [k, v] of Object.entries(staleByStepRaw)) {
    if (typeof v === "number" && Number.isFinite(v)) staleByStep[k] = v;
  }

  const deliveryRaw = str(step4SlackRaw.delivery, "node").toLowerCase();
  const delivery: Step4DeliveryMode =
    deliveryRaw === "node" ||
    deliveryRaw === "role" ||
    deliveryRaw === "direct" ||
    deliveryRaw === "dry_run" ||
    deliveryRaw === "auto" ?
      deliveryRaw
    : "node";

  const pickReceiveRaw = isObject(step4SlackRaw.pick_receive) ? step4SlackRaw.pick_receive : {};
  const pickRepliesRaw = isObject(pickReceiveRaw.replies) ? pickReceiveRaw.replies : {};
  const pickModeRaw = str(pickReceiveRaw.mode, "poll").toLowerCase();
  const pickReceiveMode: Step4PickReceiveMode = pickModeRaw === "off" ? "off" : "poll";
  const pickReceive: Step4PickReceiveConfig = {
    mode: pickReceiveMode,
    poll_on: "run-once",
    pick_timeout_hours: num(pickReceiveRaw.pick_timeout_hours, 24),
    replies: {
      success: str(pickRepliesRaw.success, DEFAULT_STEP4_PICK_REPLIES.success),
      custom_success: str(pickRepliesRaw.custom_success, DEFAULT_STEP4_PICK_REPLIES.custom_success),
      already_selected: str(pickRepliesRaw.already_selected, DEFAULT_STEP4_PICK_REPLIES.already_selected),
      invalid_pick: str(pickRepliesRaw.invalid_pick, DEFAULT_STEP4_PICK_REPLIES.invalid_pick),
      custom_invalid: str(pickRepliesRaw.custom_invalid, DEFAULT_STEP4_PICK_REPLIES.custom_invalid),
      unauthorized: str(pickRepliesRaw.unauthorized, DEFAULT_STEP4_PICK_REPLIES.unauthorized),
      out_of_range: str(pickRepliesRaw.out_of_range, DEFAULT_STEP4_PICK_REPLIES.out_of_range),
    },
  };

  const stockPriority = strList(step6StockRaw.priority, ["today", "common", "ai"]).filter(
    (p): p is "today" | "common" | "ai" => p === "today" || p === "common" || p === "ai",
  );

  const configDir = path.dirname(configPath);

  return {
    schema_version: schema,
    config_version: configVersion,
    strict,
    timezone: str(raw.timezone, "Asia/Tokyo"),
    instance_name: str(raw.instance_name, "default"),
    configDir,
    configPath,
    repoRoot,
    paths: {
      data_dir: dataDir,
      tasks_dir: resolveRepoPath(repoRoot, str(pathsRaw.tasks_dir, "./data/tasks")),
      db_path: resolveRepoPath(repoRoot, str(pathsRaw.db_path, "./data/system/orchestrator.db")),
      auth_dir: resolveRepoPath(repoRoot, str(pathsRaw.auth_dir, "./data/auth")),
      assets_img_dir: resolveRepoPath(repoRoot, str(pathsRaw.assets_img_dir, "./data/assets/img")),
      assets_video_dir: resolveRepoPath(repoRoot, str(pathsRaw.assets_video_dir, "./data/assets/video")),
      temp_dir: resolveRepoPath(repoRoot, str(pathsRaw.temp_dir, "./data/temp")),
      logs_dir: resolveRepoPath(repoRoot, str(pathsRaw.logs_dir, "./logs")),
      logs_task_dir: resolveRepoPath(repoRoot, str(pathsRaw.logs_task_dir, "./logs/task")),
      logs_publish_dir: resolveRepoPath(repoRoot, str(pathsRaw.logs_publish_dir, "./logs/publish")),
      logs_jobs_dir: resolveRepoPath(repoRoot, str(pathsRaw.logs_jobs_dir, "./logs/jobs")),
      system_log: resolveRepoPath(repoRoot, str(pathsRaw.system_log, "./logs/system.log")),
      node_dir: resolveRepoPath(repoRoot, str(pathsRaw.node_dir, "./node")),
    },
    orchestrator: {
      dispatch: { batch_limit: num(dispatchRaw.batch_limit, 10) },
      reconcile: { processing_timeout_ms: num(reconcileRaw.processing_timeout_ms, 300_000) },
      stale: {
        default_threshold_ms: num(staleRaw.default_threshold_ms, 3_600_000),
        threshold_ms_by_step: staleByStep,
        max_rollbacks_per_step_per_day: num(staleRaw.max_rollbacks_per_step_per_day, 3),
        excluded_task_statuses: strList(staleRaw.excluded_task_statuses, [
          "awaiting_manager_selection",
          "approval_timeout",
          "published",
          "publish_partial_failed",
          "failed",
          "cancelled",
          "aborted",
        ]),
      },
    },
    slack: {
      channel_id: str(slackRaw.channel_id, ""),
      allowed_user_ids: strList(slackRaw.allowed_user_ids, []),
      step4: {
        delivery,
        dry_run: bool(step4SlackRaw.dry_run, false),
        max_candidates_in_message: num(step4SlackRaw.max_candidates_in_message, 120),
        pick_receive: pickReceive,
      },
      step_completion: {
        enabled: bool(stepCompletionRaw.enabled, true),
        dry_run: bool(stepCompletionRaw.dry_run, false),
      },
      step7: {
        retry_receive: {
          mode: str(step7RetryRecvRaw.mode, "poll").toLowerCase() === "off" ? "off" : "poll",
          poll_on: "run-once",
          thread_source: str(step7RetryRecvRaw.thread_source, "step7").toLowerCase() === "step4" ? "step4" : "step7",
          replies: {
            success: str(step7RetryRepliesRaw.success, DEFAULT_STEP7_RETRY_REPLIES.success),
            invalid: str(step7RetryRepliesRaw.invalid, DEFAULT_STEP7_RETRY_REPLIES.invalid),
            unauthorized: str(step7RetryRepliesRaw.unauthorized, DEFAULT_STEP7_RETRY_REPLIES.unauthorized),
            max_attempts: str(step7RetryRepliesRaw.max_attempts, DEFAULT_STEP7_RETRY_REPLIES.max_attempts),
            error: str(step7RetryRepliesRaw.error, DEFAULT_STEP7_RETRY_REPLIES.error),
          },
        },
      },
    },
    platforms: {
      copy_required: copyRequired,
      publish_enabled: publishEnabled,
      definitions,
    },
    step1: {
      default_run_id: str(step1Raw.default_run_id, "r01"),
      default_trigger: str(step1Raw.default_trigger, "manual_debug"),
      task_id_date_format: str(step1Raw.task_id_date_format, "daily-YYYYMMDD"),
      ensure_daily: {
        enabled: bool(step1EnsureRaw.enabled, false),
        not_before_hour: Math.min(23, Math.max(0, num(step1EnsureRaw.not_before_hour, 9))),
        grace_hours: Math.min(24, Math.max(1, num(step1EnsureRaw.grace_hours, 18))),
        runs: step1EnsureRuns,
      },
    },
    step2: {
      aggregate_config_path: resolveRepoPath(repoRoot, str(step2Raw.aggregate_config_path, "./config/collect_aggregate.json")),
      standalone_config_path: resolveRepoPath(
        repoRoot,
        str(step2Raw.standalone_config_path, "./config/collect_standalone.json"),
      ),
      tophub_channels_path: resolveRepoPath(repoRoot, str(step2Raw.tophub_channels_path, "./config/tophub_channels.json")),
      allow_partial_success_continue: bool(step2Raw.allow_partial_success_continue, true),
    },
    step4: {
      pick_advance_pipeline_default: bool(step4Raw.pick_advance_pipeline_default, false),
      materialize_collect_default: bool(step4Raw.materialize_collect_default, true),
    },
    step5: {
      skip_if_research_exists: bool(step5Raw.skip_if_research_exists, true),
    },
    step6: {
      copy: {
        require_all_copy_required_platforms: bool(step6CopyRaw.require_all_copy_required_platforms, true),
        image_prompt_slot_count: num(step6CopyRaw.image_prompt_slot_count, 4),
        image_prompt_aspect_ratio: str(step6CopyRaw.image_prompt_aspect_ratio, "16:9"),
      },
      image: {
        delivery: str(step6ImageRaw.delivery, "node") === "role" ? "role" : "node",
        model: str(step6ImageRaw.model, "gemini-2.5-flash-image").replace(/^google\//, ""),
        max_slots: num(step6ImageRaw.max_slots, 4),
        require_all_slots: bool(step6ImageRaw.require_all_slots, true),
        prompt_only_on_failure: bool(step6ImageRaw.prompt_only_on_failure, false),
        stock: {
          enabled: bool(step6StockRaw.enabled, true),
          priority: stockPriority.length ? stockPriority : ["today", "common", "ai"],
          today_dir_date_format: str(step6StockRaw.today_dir_date_format, "yyyyMMdd"),
          common_dir_name: str(step6StockRaw.common_dir_name, "Common"),
          extensions: strList(step6StockRaw.extensions, [".png", ".jpg", ".jpeg"]),
          max_pick: num(step6StockRaw.max_pick, 4),
          force_ai: bool(step6StockRaw.force_ai, false),
        },
      },
    },
    step7: {
      headless: bool(step7Raw.headless, false),
      dry_run: bool(step7Raw.dry_run, false),
      xhs_dry_run: bool(step7Raw.xhs_dry_run, false),
      retry_step7_enabled: bool(step7Raw.retry_step7_enabled, true),
      validation: {
        strict: bool(step7ValidationRaw.strict, true),
        mode: step7ValidationMode,
        require_post_url: step7RequirePostUrl,
      },
      partial_retry: {
        enabled: bool(step7PartialRaw.enabled, true),
        max_attempts_per_platform: Math.max(1, num(step7PartialRaw.max_attempts_per_platform, 2)),
        auto_on_run_once: bool(step7PartialRaw.auto_on_run_once, false),
      },
      timeout_ms: num(step7Raw.timeout_ms, 900_000),
      video: {
        stock: {
          enabled: bool(step7VideoStockRaw.enabled, true),
          priority: videoStockPriority.length ? videoStockPriority : ["today", "common"],
          today_dir_date_format: str(step7VideoStockRaw.today_dir_date_format, "yyyyMMdd"),
          common_dir_name: str(step7VideoStockRaw.common_dir_name, "Common"),
          extensions: strList(step7VideoStockRaw.extensions, [".mp4"]),
          max_pick: num(step7VideoStockRaw.max_pick, 1),
        },
      },
      human_delay: {
        step_min_ms: num(step7DelayRaw.step_min_ms, 3000),
        step_max_ms: num(step7DelayRaw.step_max_ms, 5000),
        after_publish_click_ms: num(step7DelayRaw.after_publish_click_ms, 10_000),
      },
      facebook: {
        composer_entry: step7FacebookComposerEntry,
        profile_link_name: str(step7FacebookRaw.profile_link_name, ""),
      },
    },
  };
}

export function resolvePublishOrchestratorConfigPath(repoRoot: string): string {
  const configPath = path.resolve(repoRoot, "config", "publish.orchestrator.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Missing ${configPath}. Create it from publish.orchestrator.example.commented.jsonc (see config/README.md).`,
    );
  }
  return configPath;
}

export function loadPublishOrchestratorConfig(options?: { reload?: boolean }): PublishOrchestratorConfig {
  if (cached && !options?.reload) return cached;

  const workspaceDir = getWorkspaceDir();
  const repoRoot = path.resolve(workspaceDir, "..");
  const configPath = resolvePublishOrchestratorConfigPath(repoRoot);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  if (!isObject(raw)) {
    throw new Error(`${configPath} must be a JSON object`);
  }

  const config = parseConfig(raw, configPath, repoRoot);
  applyEnvOverrides(config);
  cached = config;
  return config;
}

export function getCopyPlatformLimits(platformIds?: string[]): Record<string, PlatformCopyLimits> {
  const cfg = loadPublishOrchestratorConfig();
  const ids = platformIds ?? cfg.platforms.copy_required;
  const out: Record<string, PlatformCopyLimits> = {};
  for (const id of ids) {
    const def = cfg.platforms.definitions[id];
    if (!def) continue;
    out[id] = {
      label: def.label,
      bodyMax: def.copy.body_max,
      locale: def.copy.locale,
      ...(def.copy.title_max !== undefined ? { titleMax: def.copy.title_max } : {}),
    };
  }
  return out;
}

export function getCopyPlatformAliases(): Record<string, string> {
  const cfg = loadPublishOrchestratorConfig();
  const out: Record<string, string> = {};
  for (const [id, def] of Object.entries(cfg.platforms.definitions)) {
    out[id] = id;
    for (const alias of def.aliases) {
      out[alias] = id;
      out[alias.toLowerCase()] = id;
    }
  }
  return out;
}

export function getStaleThresholdMs(stepName: string): number {
  const cfg = loadPublishOrchestratorConfig();
  return (
    cfg.orchestrator.stale.threshold_ms_by_step[stepName] ??
    cfg.orchestrator.stale.default_threshold_ms
  );
}

export function getStaleExcludedStatuses(): Set<string> {
  return new Set(loadPublishOrchestratorConfig().orchestrator.stale.excluded_task_statuses);
}

export function getMaxStaleRollbacksPerStepPerDay(): number {
  return loadPublishOrchestratorConfig().orchestrator.stale.max_rollbacks_per_step_per_day;
}
