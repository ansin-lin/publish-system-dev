const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shiftedIso(date: Date, offsetMs: number, offsetSuffix: string): string {
  return `${new Date(date.getTime() + offsetMs).toISOString().slice(0, 19)}${offsetSuffix}`;
}

export function nowIsoJst(): string {
  return shiftedIso(new Date(), JST_OFFSET_MS, "+09:00");
}

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function yyyymmddJst(date = new Date()): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

export function yyyymmddHhmmssJst(date = new Date()): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

export function yyyyMmDdShanghai(date = new Date()): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function toJstIso(value: string): string {
  const raw = value.trim();
  if (!raw) return nowIsoJst();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return shiftedIso(parsed, JST_OFFSET_MS, "+09:00");
}
