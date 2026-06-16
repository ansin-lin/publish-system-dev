/** Display orchestrator ISO timestamps as `YYYY-MM-DD HH:mm:ss`. */
export function formatJst(iso?: string): string {
  if (!iso?.trim()) return "—";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return iso.replace(/\+09:00$/, "").replace("T", " ").slice(0, 19);
}

export function formatDateLabel(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

export function todayIsoDateJst(): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}
