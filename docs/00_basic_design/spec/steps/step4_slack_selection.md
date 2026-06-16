# Step 4 详细设计：Slack 管理者选择 + 选题文件固化

> **产品定位**：在 Slack 发布编号候选列表，**等待管理者按编号反馈**；确认后生成 **`selected_topics*.json`**，并将任务推进到 **`manager_selected`**，供 **Step5 二次采集** 使用。  
> **总览**：`../pipeline_steps_overview.md`

## 1. 输入/输出

- **发帖输入**：`tidy/topic_candidates*.json`（`steps.tidy.output_ref`）；遗留可读 `analyze/clean_result*.json`（`steps.analyze.output_ref`）。
- **发帖输出**：Slack 消息（`message_ts`、`channel` 写入 `steps.approval`）。
- **选题固化输出**：
  - `DATA_ROOT/<task_id>/approve/selected_topics_YYYYMMDD[_runid].json`（`selected_topics.v1`）
  - `DATA_ROOT/<task_id>/approve/selected_collect_items_YYYYMMDD[_runid].json`（`selected_collect_items.v1`：与 `topic_candidates` 所选 **index** 对应的 `topic_id` + `source_platform`，从首轮 `collect_result` 抽全量字段；见 `../schema_artifacts.md` §3.4b）
  - `task.json`：`steps.approve.output_ref`、`steps.approve.collect_items_ref`（及时间戳字段以代码为准）
- 协议参考：`../slack_protocol.md`

## 2. 前置条件

### 2.1 发帖（Slack 通知）

- `task.status=collected` 且 `steps.tidy.status=success`（或遗留 `analyzed` + 可用候选文件）
- 配置：`config/orchestrator_slack.json` 和/或环境变量（见下文「配置项」）；投递模式 `direct` / `role` / `dry_run` 见 `step4RoleDispatch.ts`

### 2.2 固化选题（生成文件）

- `task.status=awaiting_manager_selection`
- `steps.approval.status=running`（已发帖）
- 管理者输入合法 `pick n[,n]*`；**当前实现**通过 CLI `submit-pick` 触发（Slack 线程回复不会自动入库，除非另行接入 Events API）

## 3. 处理流程（产品 Step4 全链路）

1. **发帖**：读取候选文件 → 生成 mrkdwn 正文（含 1-based 编号）→ `chat.postMessage`（direct）或 OpenClaw `publish-orchestrator`（role）或 dry_run 打印。
2. **写回**：`updateTask()` → `status=awaiting_manager_selection`，`steps.approval=running`，记录 `message_ts`、`slack_channel`、`candidate_count` 等。
3. **等待**：管理者在频道内决定编号（人审）。
4. **提交选择**：`npm run orchestrator -- submit-pick --task-id … --raw "pick …" --operator <Slack User ID>`（须符合 `allowed_slack_user_ids` 白名单，若已配置）。若任务已是 `manager_selected` 但缺 collect 切片：`materialize-collect` + 同一 `--raw` / `--indices`。
5. **校验与落盘**：解析编号 → 对照 `topic_candidates` → 写入 **`selected_topics`** 与 **`selected_collect_items`**（`applyManagerPick` 内联调用）。
6. **推进**：`updateTask()` → `steps.approval=success`、`steps.approve=success`、`status=manager_selected`。

## 4. 状态推进

- 发帖成功后：`task.status` → `awaiting_manager_selection`，`steps.approval` → `running`
- 选题成功后：`task.status` → `manager_selected`；`steps.approve.output_ref` → `selected_topics`；**`steps.approve.collect_items_ref` → `selected_collect_items`**
- 超时：`approval_timeout`（需 scheduler / 人工策略配合）

## 5. 失败与重试

- 发帖：可重试网络/Slack API 错误；配置缺失为不可重试
- 选题：索引越界、白名单拒绝 → 不可重试；可提示修正后重新 `submit-pick`（产品规则另定）

## 6. 幂等与去重

- 发帖：`task_id + run_id + message_ts`（同 `ts` 重复 pick 策略见原设计）
- 固化：`task_id + run_id + approval 内容 hash`（建议）

## 7. 产物校验

- `selected_topics.v1`、`selected_collect_items.v1`：见 `../schema_artifacts.md`
- `steps.approval` 含 `message_ts`、`raw_input`、`parsed_selection`、`operator`、`at`

## 8. 观测与审计

- 日志：`LOG_ROOT/orchestrator/step4_*`
- `task.history`：发帖、选题成功/失败事件

## 9. 配置项

- **环境变量**：`SLACK_BOT_TOKEN`、`PUBLISH_ORCH_SLACK_CHANNEL_ID`、`PUBLISH_ORCH_SLACK_ALLOWED_USERS`、`PUBLISH_ORCH_STEP4_DELIVERY`、`PUBLISH_ORCH_STEP4_DRY_RUN`；OpenClaw 网关变量（role 模式）见 `analyze/config.ts` / `step4RoleDispatch.ts`
- **文件**：`config/orchestrator_slack.json`（`channel_id`、`allowed_slack_user_ids`）；示例见 `orchestrator_slack.example.json`
- **超时提醒**（若启用）：`slack.selection.timeout.*`

## 10. 状态变化与结果文件（与 `dispatcher.ts`、`step4ApplyPick.ts` 对齐）

Step4 在实现上分为 **4a 发帖**（dispatcher）与 **4b 选题落盘**（CLI `submit-pick` → `applyManagerPick`）。**`task.json` 的变更只经 `updateTask()`**。

### 4a — Slack 发帖（`EXECUTE_STEP4_SLACK_NOTIFY`）

| 结果 | `task.status` | `steps.approval` | 落盘文件 |
|------|----------------|------------------|----------|
| **成功** | `collected` → **`awaiting_manager_selection`** | **`running`**：写入 `message_ts`、`slack_channel`、`candidate_count`、`slack_text_preview` 等 | **无**新 artifact；内容在 Slack |
| **失败** | **保持 `collected`** | **`failed`**（或等价 `stepPatch`） | 无 |

### 4b — `submit-pick` / `applyManagerPick`（选题固化）

**前置**：`task.status === "awaiting_manager_selection"` 且 `steps.approval.status === "running"`；`--operator` 须在白名单内（若已配置）。

| 写回后 | `task.status` | `steps.approval` | `steps.approve` | 落盘文件 |
|--------|----------------|------------------|-------------------|----------|
| **成功** | **`manager_selected`** | **`success`**（含 `raw_input`、`parsed_selection`、`operator`、`at` 等） | **`success`**：`input_ref`→候选文件，`output_ref`→`selected_topics`，**`collect_items_ref`→`selected_collect_items`** | 见下表 |

**结果文件（均在 `approve/`）**

| 路径模式 | Schema | 说明 |
|----------|--------|------|
| `approve/selected_topics_<JSTYYYYMMDD>_<runId>.json` | `selected_topics.v1` | 选题摘要：`selected_topic_ids`、`items[]`（`topic_id`/`title`/`source_platform` 等） |
| `approve/selected_collect_items_<JSTYYYYMMDD>_<runId>.json` | `selected_collect_items.v1` | 与所选 **index** 对应的 **`collect_result` 全量行**；含 `source_collect_ref`、`source_candidates_ref`、`selected_indices`、`topic_keys` |

### 仅补切片 — `materialize-collect`

当 **`task.status` 已是 `manager_selected`**（例如旧流程未写 `selected_collect_items`）：CLI **`materialize-collect`** 可生成/覆盖 **`selected_collect_items_*.json`**，并 **`updateTask`** 合并 **`steps.approve.collect_items_ref`**；**不改变** `task.status`（仍为 `manager_selected`）。详见 `node/src/executors/materializeSelectedCollect.ts`。
