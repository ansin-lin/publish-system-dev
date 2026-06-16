# Step 1 详细设计：任务创建与触发

**流水线总览**：`../pipeline_steps_overview.md` · **编排流程图**：`../orchestrator_flow_step1_step7.md`

## 1. 输入/输出
- 输入：调度触发参数（manual/cron）、任务上下文（主题域/平台/优先级）
- 输出：`DATA_ROOT/<task_id>/task.json`
- Schema 参考：`../schema_task.md`、`../naming_and_paths.md`

## 2. 前置条件
- 允许进入：无（新任务入口）
- 约束：`task_id` 全局唯一，`run_id` 对当前 task 唯一

## 3. 处理流程
1. 生成 `task_id`（建议：`YYYYMMDD-HHMMSS-<shortid>`，JST）
2. 生成 `run_id`（建议：`rNN` 或时间戳短码）
3. 创建目录结构（`collect` / `tidy` / `approve` / `generate` / `publish`；由 `ensureTaskDirectories` 创建）
4. 初始化 `task.json`
5. 通过 `updateTask()` 写 `steps.collect.status=running`
6. 通过 `updateTask()` 写 `task.status=collecting`，递增 `revision`
7. 插入首个 `TASK_UPDATED` outbox 事件，触发 dispatcher 决策 Step 2

## 4. 状态推进
- `steps.collect: pending -> running`
- `task.status: created -> collecting`

## 5. 失败与重试
- 可重试：目录创建临时失败、锁冲突
- 不可重试：配置缺失、路径权限拒绝
- 重试策略：最多 2 次，指数退避（1s/3s）

## 6. 幂等与去重
- 幂等键：`trigger_id + planned_time + topic_scope`
- 同幂等键重复触发时：若已有 `collecting` 任务则返回已有 task 引用，不重复建新任务
- 幂等触发返回已有任务时，仍需通过 `updateTask()` 或审计写口记录 `task.history`，并按需派发 `TASK_UPDATED` / `TASK_RECONCILE` 防止流程停滞

## 7. 产物校验
- `task.json` 必含：`schema_version/task_id/run_id/status/steps/created_at/updated_at`
- 时间字段：ISO8601 + Asia/Tokyo

## 8. 观测与审计
- 日志：`LOG_ROOT/orchestrator/step1_<task_id>_<YYYYMMDD_HHMMSS>.log`
- 审计：`task.history` 记录 task 创建、run 创建、触发来源
- 事件：创建成功后必须写入首个 `TASK_UPDATED` 事件；事件结构见 `../event_outbox_and_dispatcher.md`

## 9. 配置项
- `step1.default_run_id` / `step1.task_id_date_format`（`daily-YYYYMMDD` → `daily-<date>-r01`）
- `step1.ensure_daily`（`run-once` 兜底）：`enabled`、`not_before_hour`（默认 9 JST）、`grace_hours`（默认 18，即 09:00–次日 03:00 内若当日任务不存在则 `create-task`，trigger=`run_once_ensure`）
- `orchestrator.retry.maxAttempts`（默认 2）
- `orchestrator.retry.backoffMs`（默认 [1000,3000]）
