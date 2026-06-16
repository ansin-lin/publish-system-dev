# event_outbox_and_dispatcher.md

## 1. 适用范围

适用于 v2.1 起的 Orchestrator 事件驱动编排机制，包括：

- `updateTask()` 状态写入
- SQLite `outbox_events` 持久事件表
- dispatcher 消费与下一步决策
- scheduler 超时事件
- 服务启动恢复与 reconcile

## 2. 核心边界

1. `task.json` 是 SSOT，所有任务状态、步骤状态、产物引用、审计历史均以它为准。
2. `outbox_events` 不是状态真相，只是状态变更后的通知层。
3. `updateTask()` 是唯一状态写入口，负责加锁、校验、写 task、插入 outbox。
4. dispatcher 是唯一事件消费推进器，负责读取事件、重读 task、决策下一步。
5. dispatcher 不信任 event payload 中的状态；event payload 只作为触发上下文。
6. 事件允许重复投递，但消费必须幂等；事件丢失必须可由 reconcile 补偿。

## 3. SQLite 存储

推荐数据库路径：

`DATA_ROOT/system/orchestrator.db`

其中 `DATA_ROOT` 来自 `config/paths.json` 的 `data_dir`。

### 3.1 outbox_events 表

```sql
CREATE TABLE IF NOT EXISTS outbox_events (
  -- 全局唯一事件 ID，用于幂等消费与审计追踪。
  event_id TEXT PRIMARY KEY,
  -- 事件类型，例如 TASK_UPDATED / TASK_RECONCILE / TASK_TIMEOUT。
  event_type TEXT NOT NULL,
  -- 事件关联的任务 ID，对应 DATA_ROOT/<task_id>/task.json。
  task_id TEXT NOT NULL,
  -- 事件关联的执行批次；重跑必须使用新的 run_id。
  run_id TEXT NOT NULL,
  -- 事件产生时的 task.revision，用于 dispatcher 丢弃陈旧事件。
  revision INTEGER NOT NULL,
  -- 事件上下文 JSON；只作为触发信息，不得作为状态真相。
  payload_json TEXT NOT NULL,
  -- 事件处理状态：待处理、处理中、完成、失败。
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  -- 已重试次数，用于退避和失败判定。
  retry_count INTEGER NOT NULL DEFAULT 0,
  -- 下一次允许消费的时间（JST ISO8601）。
  next_retry_at TEXT NOT NULL,
  -- dispatcher 抢占事件的时间，用于恢复僵尸 processing 事件。
  locked_at TEXT,
  -- dispatcher 实例 ID，用于排查并发消费问题。
  locked_by TEXT,
  -- 事件创建时间（JST ISO8601）。
  created_at TEXT NOT NULL,
  -- 事件完成或失败时间（JST ISO8601）。
  processed_at TEXT
);
```

### 3.2 索引

```sql
CREATE INDEX IF NOT EXISTS idx_outbox_ready
ON outbox_events (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_outbox_task_revision
ON outbox_events (task_id, run_id, revision);
```

## 4. 事件类型

### 4.1 TASK_UPDATED

由 `updateTask()` 在成功写入 `task.json` 后插入。

最小 payload：

```json
{
  "changed_by": "orchestrator",
  "changed_fields": ["steps.collect", "status"],
  "reason": "collect_finished"
}
```

### 4.2 TASK_RECONCILE

服务启动或人工修复时由 reconcile 过程插入，用于防止事件丢失导致非终态任务停滞。

### 4.3 TASK_TIMEOUT

由 scheduler 插入，用于审批提醒、审批超时、步骤执行超时等时间驱动场景。

## 5. updateTask() 规范

`updateTask()` 必须在同一临界区内完成：

1. 按 `task_id` 获取任务锁。
2. 读取最新 `task.json`。
3. 应用事务式 mutator/patch。
4. 校验状态迁移合法性。
5. 校验步骤产物引用与必要字段。
6. `revision + 1`。
7. 更新 `updated_at`（Asia/Tokyo）。
8. 写入 `task.history`。
9. 原子写回 `task.json`。
10. 插入 `TASK_UPDATED` 事件，状态为 `pending`。
11. 可选更新 `orchestrator_meta.last_event_id`。

禁止绕过 `updateTask()` 直接推进 `task.status`。

## 6. dispatcher 消费状态机

事件状态：

- `pending`：等待消费。
- `processing`：已被 dispatcher 抢占。
- `done`：处理完成或已判定为陈旧事件。
- `failed`：超过重试上限或不可恢复错误。

消费流程：

1. 拉取 `status='pending'` 且 `next_retry_at <= now` 的事件，按 `created_at` 升序，限制批量大小。
2. 原子抢占事件：设置 `status='processing'`、`locked_at=now`、`locked_by=<dispatcher_id>`。
3. 按 `task_id` 获取任务锁。
4. 重读最新 `task.json`。
5. 若 `event.revision < task.revision`，标记事件 `done`，不做副作用。
6. 调用 `decideNextAction(task)`。
7. 触发对应 step executor 或 scheduler 动作。
8. 事件处理成功则标记 `done` 并写 `processed_at`。
9. 失败则按重试策略更新 `retry_count`、`next_retry_at`、`status`。

## 7. decideNextAction 规则（与 `node/src/orchestrator/decideNextAction.ts` 对齐）

以下为 **dispatcher 自动决策** 范围；**Step4b（`submit-pick` / `materialize-collect`）为 CLI 或 Slack 角色触发**，不在 `decideNextAction` 内。

| 条件 | 动作 |
|------|------|
| `collecting` + collect running / failed / init_failed | `EXECUTE_STEP2_COLLECT` |
| `collecting` + collect success | `ADVANCE_TO_COLLECTED` |
| `collecting` + collect partial_failed | `ADVANCE_TO_COLLECTED_DEGRADED` |
| `collected` + tidy pending/failed | `EXECUTE_TIDY` |
| `collected` + tidy success + approval pending/failed | `EXECUTE_STEP4_SLACK_NOTIFY` |
| `awaiting_manager_selection` | **NOOP**（等待 `submit-pick`） |
| `topics_selected` / `generating_research` + approve success + research 待跑 | `EXECUTE_STEP5_GENERATE_RESEARCH` |
| `research_done` / `manager_selected` + topic_research 就绪 + copy 待跑 | `EXECUTE_STEP6_GENERATE_COPY` |
| `copy_generated` / `generating_image` + image 待跑/failed/running | `EXECUTE_STEP6_GENERATE_IMAGES` |
| `image_generated` + image success + publish 待跑/failed | `EXECUTE_STEP7_PUBLISH` |
| 其它 `task.status` | **NOOP** |

**Stale 超时回退**：见 `state_transitions_table.md` §6（`reconcileStaleSteps`）。

采集失败规则：

- `steps.collect.status=failed|init_failed` 不得进入 Step3（可重试 collect）。
- `steps.collect.status=partial_failed` 可进入 Step3，并保持 `task.degraded=true`。

## 8. 重试与退避

推荐退避：

- 第 1 次失败：`next_retry_at = now + 1s`
- 第 2 次失败：`next_retry_at = now + 3s`
- 第 3 次失败：`next_retry_at = now + 10s`
- 超过上限：`status='failed'`

不可重试错误可直接标记 `failed`，并通过 `updateTask()` 写入 `steps.<step>.error` 或任务失败状态。

## 9. 锁与幂等

- 任务锁粒度：`task_id`。
- 事件锁粒度：`event_id`，由 SQLite 原子更新抢占。
- step executor 必须有幂等键，例如 `task_id + run_id + step + input_ref/hash`。
- 同一 `event_id` 不可重复产生副作用。
- 同一 step 若已有有效产物且 `steps.<step>.status=success`，重复触发应短路成功。

## 10. 恢复与 reconcile

服务启动时必须执行：

1. 将超时的 `processing` 事件按策略回退为 `pending` 或标记 `failed`。
2. 扫描所有非终态 `task.json`。
3. 对没有待处理事件的非终态任务插入 `TASK_RECONCILE`。
4. dispatcher 消费 reconcile 事件时重读 task 并调用 `decideNextAction()`。

终态建议包括：

`published / publish_partial_failed / failed / cancelled / aborted / approval_timeout`

## 11. 观测与审计

必须记录：

- `event_id`
- `event_type`
- `task_id`
- `run_id`
- `revision`
- `dispatcher_id`
- 处理耗时
- 失败原因与 retry_count

建议指标：

- pending 事件数
- processing 超时数
- failed 事件数
- 平均处理延迟
- 各 step 成功/失败计数
