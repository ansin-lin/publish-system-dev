import { loadPublishOrchestratorConfig } from "./publishOrchestratorConfig.js";

export type OrchestratorSlackStep4Config = {
  channelId: string;
  /** Slack user IDs allowed to submit picks (e.g. via CLI `--operator`). */
  allowedSlackUserIds: string[];
};

function resolveStep4DryRun(cfgDry: boolean): boolean {
  if (
    process.env.PUBLISH_ORCH_STEP4_DRY_RUN === "1" ||
    String(process.env.PUBLISH_ORCH_STEP4_DRY_RUN ?? "").toLowerCase() === "true"
  ) {
    return true;
  }
  return cfgDry;
}

/**
 * Step4 Slack: channel + allowlist from publish.orchestrator.json (env overrides applied in loader).
 */
export function loadOrchestratorSlackStep4Config(
  _settings: { repoRoot: string },
  options?: { requireSlackBotToken?: boolean; requireSlackChannel?: boolean },
): {
  botToken: string;
  dryRun: boolean;
  slack: OrchestratorSlackStep4Config;
} {
  const requireSlackBotToken = options?.requireSlackBotToken !== false;
  const requireSlackChannel = options?.requireSlackChannel !== false;

  const cfg = loadPublishOrchestratorConfig();
  const dryRun = resolveStep4DryRun(cfg.slack.step4.dry_run);

  const botToken = (process.env.SLACK_BOT_TOKEN ?? "").trim();
  if (!dryRun && requireSlackBotToken && !botToken) {
    throw new Error(
      "Missing SLACK_BOT_TOKEN for Step4 Slack post (slack.step4.delivery=node). Set SLACK_BOT_TOKEN or enable slack.step4.dry_run.",
    );
  }

  const channelId = cfg.slack.channel_id.trim();

  if (!dryRun && requireSlackChannel && !channelId) {
    throw new Error(
      "Missing Slack channel id: set slack.channel_id in publish.orchestrator.json or PUBLISH_ORCH_SLACK_CHANNEL_ID",
    );
  }

  return {
    botToken,
    dryRun,
    slack: {
      channelId,
      allowedSlackUserIds: cfg.slack.allowed_user_ids,
    },
  };
}
