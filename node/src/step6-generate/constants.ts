import { loadPublishOrchestratorConfig } from "../orchestrator/publishOrchestratorConfig.js";

/** Shared image slot count (content-copy prompts + Step6 image generation). */
export function getStep6ImageSlotCount(): number {
  return loadPublishOrchestratorConfig().step6.copy.image_prompt_slot_count;
}
