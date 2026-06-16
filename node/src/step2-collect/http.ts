import { HttpCollectError } from "./errors.js";

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new HttpCollectError(`HTTP ${response.status} ${response.statusText}: ${url}`, response.status);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<unknown> {
  const text = await fetchText(url, init, timeoutMs);
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`JSON 解析失败: ${url}: ${msg}`);
  }
}
