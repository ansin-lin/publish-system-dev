import { useQuery } from "@tanstack/react-query";
import { fetchTaskTimeline } from "../client";

export function useTimeline(taskId: string | undefined) {
  return useQuery({
    queryKey: ["timeline", taskId],
    queryFn: () => fetchTaskTimeline(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: 60_000,
  });
}
