import { useQuery } from "@tanstack/react-query";
import { fetchCronStatus, fetchDispatchLog } from "../client";

export function useCronStatus() {
  return useQuery({
    queryKey: ["system", "cron"],
    queryFn: fetchCronStatus,
    refetchInterval: 60_000,
  });
}

export function useDispatchLog(date?: string) {
  return useQuery({
    queryKey: ["system", "dispatch-log", date ?? "today"],
    queryFn: () => fetchDispatchLog(date),
    refetchInterval: 60_000,
  });
}
