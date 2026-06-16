import { useQuery } from "@tanstack/react-query";
import { fetchTask } from "../client";

export function useTaskDetail(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: 60_000,
  });
}
