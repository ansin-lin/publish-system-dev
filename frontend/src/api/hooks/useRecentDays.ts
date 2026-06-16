import { useQuery } from "@tanstack/react-query";
import { fetchDays } from "../client";
import { todayIsoDateJst } from "../../utils/formatJst";

function thirtyDaysAgoYmd(): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  const d = new Date(Date.now() + offsetMs);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function useRecentDays() {
  const to = todayIsoDateJst().replace(/-/g, "");
  const from = thirtyDaysAgoYmd();
  return useQuery({
    queryKey: ["days", from, to],
    queryFn: () => fetchDays(from, to),
    staleTime: 60_000,
  });
}
