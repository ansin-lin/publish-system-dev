import { yyyymmddJst } from "../../../node/src/orchestrator/time.js";

/** `YYYYMMDD` → `YYYY-MM-DD` */
export function formatIsoDateFromYmd(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) throw new Error(`Invalid YYYYMMDD: ${ymd}`);
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** `YYYY-MM-DD` or `YYYYMMDD` → `YYYYMMDD` */
export function parseToYmd(input: string): string {
  const trimmed = input.trim();
  if (/^\d{8}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: ${input}`);
  return `${m[1]}${m[2]}${m[3]}`;
}

export function todayYmdJst(): string {
  return yyyymmddJst();
}

export function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isYmdInRange(ymd: string, from: string, to: string): boolean {
  return compareYmd(ymd, from) >= 0 && compareYmd(ymd, to) <= 0;
}
