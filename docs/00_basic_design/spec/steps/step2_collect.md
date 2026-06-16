# Step 2 详细设计：话题采集

**流水线总览**：`../pipeline_steps_overview.md` · **编排流程图**：`../orchestrator_flow_step1_step7.md`

## 1. 输入/输出
- 输入：采集配置、`task_id`、`run_id`
- 输出：`DATA_ROOT/<task_id>/collect/collect_result_YYYYMMDD[_runid].json`
- Schema 参考：`../schema_artifacts.md`（collect_result）

## 2. 前置条件
- `task.status=collecting`
- `steps.collect.status=running`

## 3. 处理流程
1. 读取采集配置（平台、limit、时间窗口、地域）
2. 执行采集（聚合源 + standalone 源）
3. 生成 `collect_result`
4. 校验产物（schema_version/generated_at/items/meta）
5. 判定状态：success / partial_failed / failed
6. 执行器返回 `steps.collect` 结果；`task.json` 实际回写与主状态推进由 Orchestrator 通过 `updateTask()` 完成

## 4. 状态推进
- v2.1 统一规则：Executor 只负责执行本步骤、产出 artifact、返回 `steps.collect` 结果；不得直接推进 `task.status`。对 `task.json` 的实际回写与主状态推进必须由 Orchestrator 通过 `updateTask()` 完成，并生成 outbox 事件。
- 成功：
  - `steps.collect.status=success`
  - Orchestrator 推进 `task.status=collected`
- 部分失败（可用结果存在）：
  - `steps.collect.status=partial_failed`
  - `task.degraded=true`
  - Orchestrator 推进 `task.status=collected`（`ADVANCE_TO_COLLECTED_DEGRADED`），随后进入 Step3 Tidy
- 整体失败：
  - `steps.collect.status=failed` 或 `init_failed`
  - 任务进入终止/失败大类处理（由 Orchestrator 置 `failed/aborted/cancelled` 等）

## 5. 失败与重试
- 可重试：网络超时、429、临时上游错误
- 不可重试：配置非法、鉴权失败、字段结构错误
- 重试策略：单源最多 2 次，退避 2s/5s；源之间失败隔离

## 6. 幂等与去重
- 幂等键：`task_id + run_id + source + window`
- 重复触发同 run：不生成新文件名，保持同一产物文件；重试次数写入产物 `meta`/`errors`（命名规则不引入 attempt 位）

## 7. 产物校验
- 必填：`schema_version/task_id/run_id/generated_at/ok/items/meta/errors`
- `generated_at`：ISO8601 + Asia/Tokyo
- 条件：`items` 非空可进入后续；空则失败

## 8. 观测与审计
- 日志：`LOG_ROOT/collector/step2_<task_id>_<YYYYMMDD_HHMMSS>.log`
- 指标：成功条数、失败源数、耗时、重试次数
- 审计：将 source 级失败写入 `steps.collect.error` 与 `task.history`
- 事件：`steps.collect` 回写必须经 `updateTask()` 形成 `TASK_UPDATED`；dispatcher 根据最新 `task.json` 决定是否进入 Step 3

## 9. 配置项
- `collect.enabledPlatforms`
- `collect.fetchLimitPerSource`
- `collect.allowPartialSuccess`
- `collect.retry.maxAttempts`（默认 2）
- `collect.retry.backoffMs`（默认 [2000,5000]）
