import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvePublishReview,
  fetchPublishReview,
  regenerateCopyPlatforms,
} from "../client";

export function usePublishReview(taskId: string | undefined, taskStatus: string | undefined) {
  const enabled =
    Boolean(taskId) &&
    (taskStatus === "awaiting_publish_review" || taskStatus === "revising_copy");

  return useQuery({
    queryKey: ["publish-review", taskId],
    queryFn: () => fetchPublishReview(taskId!),
    enabled,
    refetchInterval: taskStatus === "revising_copy" ? 3000 : false,
  });
}

export function useApprovePublishReview(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: "approve" | "reject") => approvePublishReview(taskId, action),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["task", taskId] });
      await qc.invalidateQueries({ queryKey: ["publish-review", taskId] });
      await qc.invalidateQueries({ queryKey: ["artifact", taskId] });
    },
  });
}

export function useRegenerateCopy(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { platforms: string[]; feedback: string }) =>
      regenerateCopyPlatforms(taskId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["task", taskId] });
      await qc.invalidateQueries({ queryKey: ["publish-review", taskId] });
      await qc.invalidateQueries({ queryKey: ["artifact", taskId] });
    },
  });
}
