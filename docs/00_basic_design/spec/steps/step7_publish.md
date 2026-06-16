# Step 7 详细设计：多平台发布与回执

**流水线总览**：`../pipeline_steps_overview.md` · **编排流程图**：`../orchestrator_flow_step1_step7.md`

## 1. 输入/输出
- 输入：
  - `DATA_ROOT/<task_id>/generate/copy_result_YYYYMMDD[_runid].json`
  - `DATA_ROOT/<task_id>/generate/image_result_YYYYMMDD[_runid].json`
- 输出：`DATA_ROOT/<task_id>/publish/publish_result_YYYYMMDD[_runid].json`
- 发布执行模块：`node/src/step7-publish/`（Playwright 各平台 `platforms/*/publish.ts`）
- Schema 参考：`../schema_artifacts.md`（publish_result）

## 2. 前置条件
- `task.status=image_generated`
- `steps.image.status=success`
- 发布账号登录态可用

## 3. 处理流程
1. Orchestrator 通过 `updateTask()` 置 `task.status=publishing`、`steps.publish.status=running`
2. 调用 `node/src/step7-publish/executor.ts`（内部 `publishJob` / Playwright）
3. 按平台执行发布并收集回执
4. 写入 publish_result
5. 返回 `steps.publish` 结果
6. Orchestrator 根据回执推进到 `published` 或 `publish_partial_failed`

## 4. 状态推进
- v2.1 统一规则：Executor 只负责执行本步骤、产出 artifact、返回 `steps.publish` 结果；不得直接推进 `task.status`。对 `task.json` 的实际回写与主状态推进必须由 Orchestrator 通过 `updateTask()` 完成，并生成 outbox 事件。
- 全部成功：`task.status=published`
- 部分平台失败：`task.status=publish_partial_failed`
- 全部失败且不可恢复：`task.status=failed` 或等待人工处理状态

## 5. 失败与重试
- 可重试：平台临时错误、网络超时、浏览器瞬时失败
- 不可重试：登录态失效、素材不存在、平台内容规则拒绝
- 登录态失效不应自动重试发布；应进入人工登录/修复流程
- **部分重试**：`publish_partial_failed` 下 `publish-task --platforms …` 只补失败/未校验平台；`steps.publish.partial_retry_counts` 限制每平台次数（`step7.partial_retry.max_attempts_per_platform`）
- **Slack**：在 **Step7 完成通知帖** 的线程回复 `retry instagram` / `retry xiaohongshu`（`slack.step7.retry_receive.thread_source=step7`，`run-once` 轮询；通知正文含操作提示）
- **校验**：`step7.validation.mode` — `strict`（全文+URL 严检）/ `balanced`（默认：X 有 `post_id` 即通过；FB 看 pathname 含 `pfbid` 即通过，忽略 `notif_t=onthisday` 查询参数）/ `loose`
- **post_url 要求**：`step7.validation.require_post_url` — `true` 时 FB/IG 未抓到链接判 `failed`；`balanced`/`loose` 下默认 `false`，发帖流程完成则记 `validated`（不算 partial fail）

## 6. 幂等与去重
- 发布幂等键：`task_id + topic_id + platform + version`
- 每个平台发布前必须检查幂等键或已有回执，避免重复发帖
- 重复触发时，已成功平台不得再次发布；仅允许补发失败/未执行平台

## 7. 产物校验
- `publish_result` 必填：`schema_version/generated_at/task_id/run_id/platform_results[]`
- `platform_results[]` 必含：`platform/status/published_at|error/artifacts`
- 部分失败必须记录平台级失败原因

## 8. 观测与审计
- 编排日志：见 `logs/` 下 collector / cron 等
- **平台发布日志**：`LOG_ROOT/task/<task_id>/<platform>/default/run.log`（由 `publish.config.json` → `logs_task_dir` 决定）
- 指标：平台成功数、失败数、manual_required 数、发布耗时
- 事件：发布结果必须经 `updateTask()` 写入，终态推进必须生成 `TASK_UPDATED` 事件
- **Slack**：Step7 完成后单向通知各平台结果（成功 / 失败-登录态失效 / 失败-未知问题 / 跳过），见 **`../step_completion_slack_notify.md`**。实现：`node/src/step7-publish/executor.ts` + `stepNotifyDetail.formatStep7PlatformLines`

## 8.1 配图输入（与 Step6 库存）

- Step7 **只读** `image_result.images[]` 中 `status=success` 的 `asset_path`（含库存路径与 AI 生成路径），**不再**回查 `assets/img`。库存逻辑见 **`../step6_stock_images.md`**。

## 9. 配置项
- `platforms.publish_enabled`
- `step7.validation.mode`（`strict` | `balanced` | `loose`）
- `step7.validation.require_post_url`（默认：`strict` 为 `true`，`balanced`/`loose` 为 `false`）
- `step7.partial_retry.enabled` / `max_attempts_per_platform` / `auto_on_run_once`
- `step7.retry_step7_enabled`（关闭则禁用 partial 编排重试）
- `slack.step7.retry_receive`（Slack `retry` 命令）
