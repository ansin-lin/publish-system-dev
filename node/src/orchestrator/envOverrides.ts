import type { PublishOrchestratorConfig } from "./publishOrchestratorConfig.js";

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return undefined;
}

function parsePlatformList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

/** Whitelist only: env name → mutates loaded config. */
export function applyEnvOverrides(config: PublishOrchestratorConfig): void {
  const notify = parseBool(process.env.PUBLISH_ORCH_STEP_NOTIFY);
  if (notify !== undefined) config.slack.step_completion.enabled = notify;

  const notifyDry = parseBool(process.env.PUBLISH_ORCH_STEP_NOTIFY_DRY_RUN);
  if (notifyDry !== undefined) config.slack.step_completion.dry_run = notifyDry;

  const step4Dry = parseBool(process.env.PUBLISH_ORCH_STEP4_DRY_RUN);
  if (step4Dry !== undefined) config.slack.step4.dry_run = step4Dry;

  const step4Delivery = process.env.PUBLISH_ORCH_STEP4_DELIVERY?.trim().toLowerCase();
  if (
    step4Delivery === "node" ||
    step4Delivery === "direct" ||
    step4Delivery === "dry_run" ||
    step4Delivery === "role" ||
    step4Delivery === "auto"
  ) {
    config.slack.step4.delivery =
      step4Delivery === "direct" || step4Delivery === "role" || step4Delivery === "auto" ? "node" : step4Delivery;
  }

  const channel = process.env.PUBLISH_ORCH_SLACK_CHANNEL_ID?.trim();
  if (channel) config.slack.channel_id = channel;

  const allowed = parsePlatformList(process.env.PUBLISH_ORCH_SLACK_ALLOWED_USERS);
  if (allowed) config.slack.allowed_user_ids = allowed;

  const imageDelivery = process.env.PUBLISH_ORCH_STEP6_IMAGE_DELIVERY?.trim().toLowerCase();
  if (imageDelivery === "node" || imageDelivery === "role") {
    config.step6.image.delivery = imageDelivery;
  }

  const forceAi = parseBool(process.env.PUBLISH_ORCH_FORCE_AI_IMAGES);
  if (forceAi !== undefined) config.step6.image.stock.force_ai = forceAi;

  const publishPlatforms = parsePlatformList(process.env.PUBLISH_ORCH_STEP7_PLATFORMS);
  if (publishPlatforms) config.platforms.publish_enabled = publishPlatforms;

  const step7Dry = parseBool(process.env.PUBLISH_ORCH_STEP7_DRY_RUN);
  if (step7Dry !== undefined) config.step7.dry_run = step7Dry;

  const headless = parseBool(
    process.env.PUBLISH_ORCH_STEP7_HEADLESS ?? process.env.PUBLISH_HEADLESS,
  );
  if (headless !== undefined) config.step7.headless = headless;

  const imageModel = process.env.PUBLISH_ORCH_IMAGE_MODEL?.trim()
    || process.env.PUBLISH_ORCH_IMAGE_GENERATION_MODEL?.trim();
  if (imageModel) {
    config.step6.image.model = imageModel.replace(/^google\//, "");
  }
}
