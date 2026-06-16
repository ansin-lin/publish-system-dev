export function nowIsoJst(): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  return `${new Date(Date.now() + offsetMs).toISOString().slice(0, 19)}+09:00`;
}

/** Human-readable JST timestamp for Slack/UI: `yyyy-mm-dd HH:mm:ss`. */
export function formatDisplayJst(isoOrNow?: string): string {
  const raw = isoOrNow?.trim() || nowIsoJst();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  const fallback = raw.replace(/\+09:00$/, "").replace("T", " ");
  return fallback.length >= 19 ? fallback.slice(0, 19) : fallback;
}

export function nowDisplayJst(): string {
  return formatDisplayJst();
}

export function yyyymmddHhmmssJst(): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

/** Calendar date in Asia/Tokyo for artifact filenames (`YYYYMMDD`). */
export function yyyymmddJst(): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Local hour (0–23) in Asia/Tokyo. */
export function jstHour(): number {
  const offsetMs = 9 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).getUTCHours();
}

/** Parse orchestrator timestamps like `2026-05-21T12:00:00+09:00` to UTC epoch ms. */
export function parseIsoJstMs(iso: string): number | null {
  const trimmed = iso.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  return Date.UTC(y, mo, d, h - 9, mi, s);
}

export function ageMsSinceIsoJst(iso: string | undefined, nowMs: number = Date.now()): number | null {
  if (!iso || !iso.trim()) return null;
  const started = parseIsoJstMs(iso);
  if (started === null) return null;
  return nowMs - started;
}
