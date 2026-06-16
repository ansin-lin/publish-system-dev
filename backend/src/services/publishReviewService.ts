import { loadOrchestratorSettings } from "../../../node/src/orchestrator/config.js";
import { taskJsonPath } from "../../../node/src/orchestrator/taskStore.js";
import { applyPublishReview } from "../../../node/src/step6-review/applyPublishReview.js";
import { getPublishReviewContext } from "../../../node/src/step6-review/getPublishReviewContext.js";
import { regenerateCopyPlatforms } from "../../../node/src/step6-review/regenerateCopyPlatforms.js";

export function createPublishReviewService() {
  const settings = loadOrchestratorSettings();

  return {
    getContext(taskId: string) {
      const path = taskJsonPath(settings, taskId);
      return getPublishReviewContext(path);
    },

    async approve(taskId: string, action: "approve" | "reject", operator = "dashboard") {
      const path = taskJsonPath(settings, taskId);
      return applyPublishReview({
        taskJsonPath: path,
        action,
        operator,
        settings,
      });
    },

    async regenerateCopy(
      taskId: string,
      platforms: string[],
      feedback: string,
      operator = "dashboard",
    ) {
      const path = taskJsonPath(settings, taskId);
      return regenerateCopyPlatforms({
        taskJsonPath: path,
        platforms,
        feedback,
        operator,
        settings,
      });
    },
  };
}

export type PublishReviewService = ReturnType<typeof createPublishReviewService>;
