/**
 * 发布时是否无头浏览器。默认 **有界面**（headless=false），便于观察 Playwright 操作。
 * 无头：CLI `--headless` 或环境变量 `PUBLISH_HEADLESS=1` / `PUBLISH_ORCH_STEP7_HEADLESS=1`
 */
export function resolvePublishHeadless(params: {
  /** CLI `--headless` 为 true 时无头 */
  cliHeadless?: boolean;
  /** publish.orchestrator.json step7.headless */
  configHeadless?: boolean;
  /** job.json 的 options.headless */
  jobHeadless?: boolean;
  /** 环境变量字符串 */
  envHeadless?: string | undefined;
} = {}): boolean {
  if (params.cliHeadless === true) return true;
  const raw = params.envHeadless?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (params.jobHeadless !== undefined) return params.jobHeadless;
  if (params.configHeadless === true) return true;
  return false;
}
