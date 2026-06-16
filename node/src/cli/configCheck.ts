import {
  getCopyPlatformLimits,
  loadPublishOrchestratorConfig,
} from "../orchestrator/publishOrchestratorConfig.js";
import { resolveStep4DeliveryMode } from "../step4-approval/step4Delivery.js";

function main(): void {
  const cfg = loadPublishOrchestratorConfig();
  const limits = getCopyPlatformLimits();
  const copy_locales = Object.fromEntries(
    Object.entries(limits).map(([id, lim]) => [id, lim.locale]),
  );
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        config_path: cfg.configPath,
        schema_version: cfg.schema_version,
        instance_name: cfg.instance_name,
        repo_root: cfg.repoRoot,
        tasks_dir: cfg.paths.tasks_dir,
        db_path: cfg.paths.db_path,
        dispatch_batch_limit: cfg.orchestrator.dispatch.batch_limit,
        copy_platforms: Object.keys(limits),
        copy_locales,
        instagram_body_max: limits.instagram?.bodyMax,
        youtube_title_max: limits.youtube?.titleMax,
        youtube_body_max: limits.youtube?.bodyMax,
        step7_timeout_ms: cfg.step7.timeout_ms,
        step7_video_stock_extensions: cfg.step7.video.stock.extensions,
        step4_delivery: cfg.slack.step4.delivery,
        step4_delivery_resolved: resolveStep4DeliveryMode(),
        step4_pick_receive_mode: cfg.slack.step4.pick_receive.mode,
        step4_pick_advance_default: cfg.step4.pick_advance_pipeline_default,
      },
      null,
      2,
    ),
  );
}

main();
