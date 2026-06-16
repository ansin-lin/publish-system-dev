import { useQuery } from "@tanstack/react-query";
import { fetchOutbox } from "../client";

export function useOutboxSummary() {
  return useQuery({
    queryKey: ["outbox", "summary"],
    queryFn: () => fetchOutbox({ limit: 20 }),
    refetchInterval: 60_000,
  });
}

export function useOutboxFiltered(status?: string, taskId?: string) {
  return useQuery({
    queryKey: ["outbox", status, taskId],
    queryFn: () =>
      fetchOutbox({
        ...(status ? { status } : {}),
        ...(taskId ? { task_id: taskId } : {}),
        limit: 100,
      }),
    refetchInterval: 60_000,
  });
}
