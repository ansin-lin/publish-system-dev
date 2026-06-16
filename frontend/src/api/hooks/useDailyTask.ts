import { useQuery } from "@tanstack/react-query";
import { fetchPrimaryDay } from "../client";

export function useDailyTask(date?: string) {
  return useQuery({
    queryKey: ["daily-task", date ?? "today"],
    queryFn: () => fetchPrimaryDay(date),
    refetchInterval: 60_000,
  });
}
