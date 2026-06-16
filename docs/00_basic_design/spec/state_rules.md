# state_rules.md

## 1. 适用范围
适用于任务状态推进、步骤状态映射、失败语义、重跑语义。

## 2. 状态层次
- `task.status`：仅表示主流程大阶段
- `steps.<step>.status`：表示步骤执行细粒度状态

规则：先更新 `steps`，后更新 `task`。

v2.1 规则：
- `task.json` 是状态真相（SSOT），`outbox_events` 只是状态变更通知层。
- `updateTask()` 是唯一状态写入口；禁止执行器直接推进 `task.status`。
- 每次 `updateTask()` 成功写入必须递增 `task.revision` 并插入 `TASK_UPDATED` 事件。
- dispatcher 消费事件时必须重读最新 `task.json`，不得直接信任 event payload 中的状态。

## 3. 采集失败语义
- `steps.collect.status=init_failed`：不允许进入 Step3（Tidy）
- `steps.collect.status=failed`：不允许进入 Step3（Tidy）
- `steps.collect.status=partial_failed`：允许进入 Step3（Tidy，降级模式），并在 task 标记 `degraded=true`

## 4. 发布失败语义
- 任务级部分失败统一使用：`task.status=publish_partial_failed`
- 平台级细节写入 `publish_result.platform_results[]`

## 5. 可选审批状态
若启用发布前抽检：
- 进入：`awaiting_publish_review`
- 通过后进入：`publishing`
- 驳回进入：`cancelled` 或发起新 `run_id` 重跑

## 6. 重跑与回退
- 禁止把旧 run 的 task.status 回改到早期阶段
- 重跑必须生成新 `run_id` 与新产物版本

## 7. 幂等规则
发布幂等键建议：`task_id + topic_id + platform + version`
重复触发时先查幂等键，避免重复发布。

## 8. 事件消费规则（v2.1）
- dispatcher 处理事件前必须按 `task_id` 加锁，并重读最新 `task.json`。
- 若 `event.revision < task.revision`，该事件视为陈旧事件，应标记为 `done`，不得再次推进状态。
- 同一 `event_id` 不可重复产生副作用；重复消费时必须通过事件状态、步骤幂等键或产物校验短路。
- event payload 只作为触发上下文，不作为状态判断依据；状态判断必须基于最新 `task.json`。
- 若 dispatcher 在 `processing` 状态中断，恢复流程应按 `locked_at` / `next_retry_at` 将超时事件回退为 `pending` 或标记为 `failed`。
- 服务启动时必须执行 reconcile：扫描非终态 `task.json` 并派发补偿事件，防止事件丢失导致流程停滞。

## 9. 状态迁移表（与代码对齐）

`task.status` 的允许迁移边以代码为准，见同目录 **`state_transitions_table.md`**（与 `node/src/orchestrator/transitionGuard.ts` 同步维护）。
