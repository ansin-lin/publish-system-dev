import type { MergedImageSlot } from "./mergeImagePrompts.js";
import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";
import { runContentImageNode } from "./imageNodeGenerate.js";
import { runContentImageRole } from "./imageRoleDispatch.js";
import type { GeneratedImageRecord } from "./imageRecords.js";

export type Step6ImageDeliveryMode = "node" | "role";

/**
 * Step6 image delivery: publish.orchestrator.json `step6.image.delivery`,
 * overridable by `PUBLISH_ORCH_STEP6_IMAGE_DELIVERY`.
 */
export function resolveStep6ImageDeliveryMode(): Step6ImageDeliveryMode {
  const explicit = process.env.PUBLISH_ORCH_STEP6_IMAGE_DELIVERY?.trim().toLowerCase();
  if (explicit === "node" || explicit === "role") return explicit;
  return loadPublishOrchestratorConfig().step6.image.delivery;
}

export async function generateTopicImages(params: {
  task_id: string;
  run_id: string;
  topic_id: string;
  title: string;
  output_dir: string;
  slots: MergedImageSlot[];
}): Promise<GeneratedImageRecord[]> {
  const mode = resolveStep6ImageDeliveryMode();
  if (mode === "role") {
    return runContentImageRole(params);
  }
  return runContentImageNode(params);
}
