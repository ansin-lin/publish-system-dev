import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";

/** Runtime Step4 Slack post mode (PR-1: node chat.postMessage only). */
export type Step4RuntimeDelivery = "node" | "dry_run";

function warnDeprecatedRole(source: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[Step4] ${source}: delivery "role" is deprecated; using node (Slack chat.postMessage with SLACK_BOT_TOKEN).`,
  );
}

/**
 * How Step4 posts the candidate list to Slack:
 * - `PUBLISH_ORCH_STEP4_DELIVERY` = node | direct | dry_run (role/auto → node with warning)
 * - `PUBLISH_ORCH_STEP4_DRY_RUN=1` → dry_run
 * - else `slack.step4.delivery` from publish.orchestrator.json (default node)
 */
export function resolveStep4DeliveryMode(): Step4RuntimeDelivery {
  const explicit = process.env.PUBLISH_ORCH_STEP4_DELIVERY?.trim().toLowerCase();
  if (explicit === "dry_run") return "dry_run";
  if (explicit === "node" || explicit === "direct") return "node";
  if (explicit === "role" || explicit === "auto") {
    warnDeprecatedRole("PUBLISH_ORCH_STEP4_DELIVERY");
    return "node";
  }

  if (
    process.env.PUBLISH_ORCH_STEP4_DRY_RUN === "1" ||
    String(process.env.PUBLISH_ORCH_STEP4_DRY_RUN ?? "").toLowerCase() === "true"
  ) {
    return "dry_run";
  }

  const cfgDelivery = loadPublishOrchestratorConfig().slack.step4.delivery;
  if (cfgDelivery === "dry_run") return "dry_run";
  if (cfgDelivery === "role" || cfgDelivery === "auto") {
    warnDeprecatedRole("slack.step4.delivery");
    return "node";
  }
  return "node";
}
