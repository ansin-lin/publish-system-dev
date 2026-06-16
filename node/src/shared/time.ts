/**
 * 时间工具：统一输出 UTC ISO8601，便于日志与结果对齐。
 */
export function nowIso(): string {
  return new Date().toISOString();
}

