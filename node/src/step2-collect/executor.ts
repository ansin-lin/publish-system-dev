import { executeCollectTask } from "../step2-collect/index.js";
import type { JsonObject } from "../step2-collect/types.js";

export type Step2CollectExecution = {
  outputPath: string;
  stepPatch: JsonObject;
  degraded: boolean;
  ok: boolean;
};

export async function executeStep2Collect(taskJsonPath: string): Promise<Step2CollectExecution> {
  const { outputPath, result } = await executeCollectTask({ taskJsonPath });
  const ok = result.ok === true && result.items.length > 0;
  const stepPatch: JsonObject = {
    output_ref: outputPath,
    finished_at: result.generated_at,
  };

  let degraded = false;
  if (ok && result.errors.length === 0) {
    stepPatch.status = "success";
  } else if (ok) {
    stepPatch.status = "partial_failed";
    degraded = true;
  } else {
    stepPatch.status = "failed";
    stepPatch.error = {
      code: "NO_VALID_ITEMS",
      message: "collect_result has no items",
      retryable: false,
    };
  }

  return { outputPath, stepPatch, degraded, ok };
}
