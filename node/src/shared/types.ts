/**
 * 共享类型定义（core / platforms / cli / api 共用）。
 */

import type { BrowserContext, Page } from "playwright";

export const PLATFORM_IDS = ["x", "instagram", "facebook", "xiaohongshu", "youtube", "tiktok"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

export type JobTarget = {
  platform: PlatformId;
  profile?: string; // 默认 default
  /** 单 target 发布模式；混合 job 时图文/视频平台分别指定 */
  mode?: PublishMode;
};

export type PlatformPayload = {
  content?: {
    body?: string;
    title?: string;
    tags?: string[];
  };
  images?: string[];
  /**
   * 与 `images` 同级。`--mode post` 时忽略；`--mode video` 时必填，且须为**绝对路径**（本机视频文件）。
   */
  video?: string;
};

/** `post`：图文；`video`：仅视频（与图文命令分离，见 CLI `--mode`） */
export type PublishMode = "post" | "video";

export type JobJson = {
  task_id: string;
  publish_id: string;
  targets: JobTarget[];
  /**
   * 旧版顶层字段（兼容保留）：当 payloads 里缺失对应平台时会回落到这里。
   * 建议未来改为只使用 payloads。
   */
  content?: {
    body?: string;
    /** 小红书图文发布必填标题 */
    title?: string;
    /** 话题标签，正文中 #话题 形式 */
    tags?: string[];
  };
  images?: string[];
  /**
   * 与 `images` 同级。`--mode post` 时忽略；`--mode video` 时必填，且须为**绝对路径**。
   */
  video?: string;
  /**
   * 方案 C：按平台分组的稿件与媒体来源。
   * - payloads.default：全局兜底
   * - payloads.<platform>：平台覆盖
   * 合并顺序：platform > default > 旧顶层字段
   */
  payloads?: Partial<Record<PlatformId | "default", PlatformPayload>>;
  options?: {
    headless?: boolean;
    slowmo_ms?: number;
    timeout_ms?: number;
    /** 发帖后必须抓到 post_url，否则平台层返回 failed（strict 默认 true） */
    require_post_url?: boolean;
    /** 点击发布按钮后的固定等待（毫秒） */
    after_publish_click_ms?: number;
    /** 编排器 step7.validation.mode，供平台层 URL 格式校验 */
    validation_mode?: "strict" | "balanced" | "loose";
    /** 仅小红书：填表与上传后不点发布，用于校验选择器 */
    xhs_dry_run?: boolean;
    /** 仅 X 测试：填表与上传后不点 Post */
    x_dry_run?: boolean;
  };
};

export type Account = {
  username?: string;
  password?: string;
  phone?: string;
};

export type Settings = {
  workspaceDir: string;
  payloadJobPath: string;
  accountsDir: string;
  storageDir: string;
  artifactsDir: string;
  chromeProfilesDir: string;
  imageRootDir: string;
  loginTimeoutMs: number;
};

export type RunOptions = {
  headless: boolean;
  slowMoMs: number;
  timeoutMs: number;
  mode: PublishMode;
  /** 未设置时默认 true（CLI 直跑保持严格） */
  requirePostUrl?: boolean;
  afterPublishClickMs?: number;
  validationMode?: "strict" | "balanced" | "loose";
};

export type PostAssets = {
  baseDir: string; // job.json 所在目录，用于解析相对路径
  caption: string;
  mediaFiles: string[]; // 绝对路径
  /** 与 CLI `--mode` 一致；`video` 时 `mediaFiles` 仅含一个本机视频绝对路径 */
  mode: PublishMode;
  meta: Record<string, unknown>;
};

export type PublishArtifacts = {
  runDir: string;
  logPath: string;
  resultPath: string;
  screenshotPath: string;
};

export type PublishContext = {
  page: Page;
  context: BrowserContext;
  assets: PostAssets;
  account: Account;
  artifacts: PublishArtifacts;
  job: JobJson;
  target: { platform: PlatformId; profile: string };
  options: RunOptions;
  settings: Settings;
};

export type PublishResult =
  | {
      status: "published";
      platform: PlatformId;
      profile: string;
      task_id: string;
      publish_id: string;
      published_at: string;
      post_url?: string;
      post_id?: string;
      artifacts: PublishArtifacts;
    }
  | {
      /** 登录态失效：发布阶段不做登录，由 OpenClaw 触发 login 流程 */
      status: "auth_expired";
      platform: PlatformId;
      profile: string;
      task_id: string;
      publish_id: string;
      reason: string;
      artifacts: PublishArtifacts;
    }
  | {
      /** 跳过：按规则不发布（例如 content.body 为空） */
      status: "skipped";
      platform: PlatformId;
      profile: string;
      task_id: string;
      publish_id: string;
      reason: string;
      artifacts: PublishArtifacts;
    }
  | {
      /** dry_run 或未抓到 post_url 时：流程完成但 verified=false */
      status: "validated";
      platform: PlatformId;
      profile: string;
      task_id: string;
      publish_id: string;
      reason?: string;
      published_at?: string;
      post_url?: string;
      artifacts: PublishArtifacts;
    }
  | {
      status: "failed" | "manual_required";
      platform: PlatformId;
      profile: string;
      task_id: string;
      publish_id: string;
      error: string;
      artifacts: PublishArtifacts;
    };

export type PlatformPublisher = (ctx: PublishContext) => Promise<PublishResult> | PublishResult;

export type LoginContext = {
  page: Page;
  context: BrowserContext;
  account: Account;
  artifacts: PublishArtifacts;
  target: { platform: PlatformId; profile: string };
  options: RunOptions;
  settings: Settings;
};

export type LoginResult =
  | {
      status: "login_ok";
      platform: PlatformId;
      profile: string;
      artifacts: PublishArtifacts;
    }
  | {
      status: "login_timeout";
      platform: PlatformId;
      profile: string;
      error: string;
      artifacts: PublishArtifacts;
    }
  | {
      status: "failed";
      platform: PlatformId;
      profile: string;
      error: string;
      artifacts: PublishArtifacts;
    };

export type PlatformLogin = (ctx: LoginContext) => Promise<LoginResult> | LoginResult;

