import { useQuery } from "@tanstack/react-query";
import { fetchDailyTasks } from "../client";

export function useDailyTasks(date?: string) {
  return useQuery({
    queryKey: ["daily-tasks", date ?? "today"],
    queryFn: () => fetchDailyTasks(date),
    refetchInterval: 60_000,
  });
}
