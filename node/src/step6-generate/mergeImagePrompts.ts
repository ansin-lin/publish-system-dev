import { getStep6ImageSlotCount } from "./constants.js";

export type CopyImagePrompt = {
  slot_id: string;
  prompt: string;
  style?: string;
  aspect_ratio?: string;
};

export type MergedImageSlot = {
  slot_id: string;
  merged_prompt: string;
  research_image_hint: string;
  copy_image_prompt: string;
  style?: string;
  aspect_ratio?: string;
};

/**
 * Merge copy image_prompts (fixed 4) with at most the first 4 research.images hints.
 * research.images[4+] are ignored for merge/slots.
 */
export function mergeImagePromptSlots(
  researchImages: string[],
  copyPrompts: CopyImagePrompt[],
): MergedImageSlot[] {
  const slotCount = getStep6ImageSlotCount();
  const cappedCopy = copyPrompts.slice(0, slotCount);
  const researchSlice = researchImages.slice(0, slotCount);
  const slots: MergedImageSlot[] = [];

  for (let i = 0; i < slotCount; i += 1) {
    const researchHint = researchSlice[i]?.trim() ?? "";
    const copyRow = cappedCopy[i];
    const copyPrompt = copyRow?.prompt?.trim() ?? "";
    const slot_id = copyRow?.slot_id?.trim() || `img_${i + 1}`;

    const parts: string[] = [];
    if (copyPrompt) parts.push(copyPrompt);
    if (researchHint) {
      parts.push(
        copyPrompt ?
          `Scene / composition from research brief: ${researchHint}`
        : researchHint,
      );
    }
    if (!parts.length) {
      parts.push("Professional IT promotion editorial illustration, clean tech aesthetic.");
    }

    const slot: MergedImageSlot = {
      slot_id,
      merged_prompt: parts.join("\n\n"),
      research_image_hint: researchHint,
      copy_image_prompt: copyPrompt,
      style: copyRow?.style?.trim() || "tech editorial",
      aspect_ratio: copyRow?.aspect_ratio?.trim() || "16:9",
    };
    slots.push(slot);
  }

  return slots;
}
