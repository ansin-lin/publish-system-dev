import type { Page } from "playwright";

/** 模拟人工操作：关键步骤前后随机等待（默认 3–5 秒）。 */
export const HUMAN_STEP_MIN_MS = 3000;
export const HUMAN_STEP_MAX_MS = 5000;

export function randomHumanDelayMs(minMs = HUMAN_STEP_MIN_MS, maxMs = HUMAN_STEP_MAX_MS): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

export async function humanStepWait(
  page: Page,
  writeLog?: (message: string) => void,
  label?: string,
  minMs = HUMAN_STEP_MIN_MS,
  maxMs = HUMAN_STEP_MAX_MS,
): Promise<void> {
  const ms = randomHumanDelayMs(minMs, maxMs);
  if (writeLog && label) writeLog(`human wait ${label} ${ms}ms`);
  await page.waitForTimeout(ms);
}

/** 点击「发布/投稿」后固定等待，再执行校验、关弹窗等后续步骤。 */
export const POST_PUBLISH_SETTLE_MS = 10_000;

export async function humanWaitAfterPublishClick(
  page: Page,
  writeLog?: (message: string) => void,
  ms: number = POST_PUBLISH_SETTLE_MS,
): Promise<void> {
  if (writeLog) writeLog(`post-publish settle ${ms}ms after publish button click`);
  await page.waitForTimeout(ms);
}

/** 在 action 前后各等待一次（默认各 3–5 秒）。 */
export async function withHumanPacing<T>(
  page: Page,
  label: string,
  action: () => Promise<T>,
  writeLog?: (message: string) => void,
): Promise<T> {
  await humanStepWait(page, writeLog, `${label}:before`);
  const result = await action();
  await humanStepWait(page, writeLog, `${label}:after`);
  return result;
}
