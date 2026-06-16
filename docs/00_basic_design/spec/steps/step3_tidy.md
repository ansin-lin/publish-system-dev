# Step 3 详细设计：话题整理（Tidy）

> **总览**：`../pipeline_steps_overview.md`；主文档摘要：`../../basic_design.md` §3。历史上 Step3 曾由 `analyzer-role` 产出 `clean_result`（**已废弃**）；当前 **Step3 = 话题整理**：从首轮采集结果生成带 **1-based 编号** 的 `topic_candidates.v1`，供 **Step4** Slack 选题。无 LLM、无 OpenClaw 分析角色。

## 1. 输入/输出

- 输入：`DATA_ROOT/<task_id>/collect/collect_result_YYYYMMDD[_runid].json`（`steps.collect.output_ref`）
- 输出：`DATA_ROOT/<task_id>/tidy/topic_candidates_<JSTYYYYMMDD>_<runId>.json`
- Schema：`../schema_artifacts.md`（`topic_candidates.v1`）

## 2. 前置条件

- `task.status=collected`
- `steps.collect.status=success` 或 `partial_failed`（降级时 `task.degraded=true`；仍须有可读 `collect_result`）

## 3. 执行模型

- **唯一实现**：Node `executeTidyFromCollect`（`node/src/step3-tidy/runner.ts`），由 `dispatcher` 在 `EXECUTE_TIDY` 动作下调用。
- 校验 `collect_result` 与 `task.json` 的 `task_id` / `run_id` 一致。
- 成功时 `updateTask()` 回写 `steps.tidy.status=success` 与 `output_ref`；**不**将 `task.status` 改为 `analyzed`（主状态保持 `collected` 直至 Step4 发出 Slack 后进入 `awaiting_manager_selection`）。

## 4. 处理流程

1. Orchestrator 置 `steps.tidy.status=running`（`task.status` 仍为 `collected`，或见下节遗留态）。
2. 读取 `collect_result.items[]`，为每条有 `topic_id`（或兼容字段 `id`）的项分配递增 `index`（从 1 起）。
3. 写入 `topic_candidates.v1`（含 `source_platform` / `source_url` 等）。
4. `updateTask()`：`steps.tidy=success` + `output_ref`。

## 5. 状态推进

- `task.status`：在默认链路中 **保持 `collected`**，直至 Step4 成功将任务推进到 `awaiting_manager_selection`。

## 6. 失败与重试

- 不可重试：`TIDY_INPUT_MISMATCH`、`TIDY_EMPTY_INPUT`、`TIDY_NO_TOPIC_IDS`
- 可重试：本地磁盘写入失败（由上层重试策略决定）

## 7. 幂等

- 每次运行可生成新文件名（含日期）；以 `steps.tidy.output_ref` 指向的当前文件为准。
- 重复派发：应通过 `steps.tidy.status` 与产物校验避免重复副作用（与 outbox 陈旧事件规则一致）。

## 8. 观测与审计

- 指标：输入条数、写出候选条数、耗时
- `task.history`：记录 `tidy_started` / `tidy_finished` / `tidy_failed`（由 `dispatcher` 的 `updateTask` reason 体现）

## 9. 配置项

- 无独立分析策略配置；采集与选题策略在 Step2 / Step4 文档中约定。

## 10. 状态变化与结果文件（与 `node/src/orchestrator/dispatcher.ts`、`node/src/step3-tidy/runner.ts` 对齐）

### `task.status` 与 `steps.tidy`

| 时机 | `task.status` | `steps.tidy` | 说明 |
|------|----------------|--------------|------|
| 进入 Tidy 前 | `collected` | `pending` / `failed` / 无 → 将置 `running` | `decideNextAction` → `EXECUTE_TIDY` |
| `tidy_started` 写回后 | `collected` | **`running`**（`started_at`） | 仅改 `steps.tidy` |
| **`tidy_finished` 成功** | **`collected`** | **`success`**，`output_ref` / `input_ref` / `finished_at` 等 | 成功产物见下表 |
| **`tidy_failed`** | `collected` | **`failed`** + `error` | 无有效 `topic_candidates` |

### 结果文件（artifact）

| 路径模式 | Schema | 说明 |
|----------|--------|------|
| `DATA_ROOT/<task_id>/tidy/topic_candidates_<JSTYYYYMMDD>_<runId>.json` | `topic_candidates.v1` | 成功时写入；`source_collect_ref` 指向 `collect_result`；`items[]` 含 **1-based `index`**、`topic_id`、`title`、`source_platform`、`source_url` |

> **`task.status` 在 Step3 成功后的默认主路径仍为 `collected`**，直至 Step4 发帖成功后才会变为 `awaiting_manager_selection`（见 Step4 文档 §10）。
