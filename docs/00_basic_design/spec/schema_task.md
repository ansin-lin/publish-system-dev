# schema_task.md

## 1. 适用范围
适用于 Orchestrator 与所有执行单元对 `task.json` 的读写。

## 2. 兼容与版本策略
- 必须包含：`schema_version`（如 `task-schema.v1`）
- 新增字段：向后兼容（旧消费者可忽略）
- 废弃字段：至少保留一个版本周期，并在 `deprecated_fields` 说明

## 3. 核心结构（最小）
- `task_id`：任务唯一ID
- `run_id`：本次执行批次ID
- `schema_version`
- `pipeline_version`
- `status`：任务主状态
- `revision`：任务修订号，初始为 `0` 或 `1`，每次通过 `updateTask()` 成功写入时递增
- `degraded`：是否处于降级执行模式（例如采集 `partial_failed` 后继续 Step3 Tidy）
- `steps`：步骤状态对象
- `history`：状态变更与关键事件
- `created_at` / `updated_at`（ISO8601+时区，统一使用 `Asia/Tokyo`）
- `orchestrator_meta`（可选）：总控运行元数据，例如 `last_event_id`、`last_dispatcher_id`

兼容说明：旧任务缺失 `revision` 时按 `0` 处理；第一次 `updateTask()` 写入后必须补齐并递增。

## 4. steps 结构约束

典型键名：`collect`、`tidy`、`approval`、`approve`、（遗留）`analyze`、以及后续流水线步骤。

`steps.<step>.status` 建议枚举：
`pending | running | success | failed | partial_failed | init_failed`

每步建议字段：
- `status`
- `started_at`
- `finished_at`
- `input_ref`
- `output_ref`
- `error`（code/message/retryable）

## 5. 必填规则
- 所有状态变更必须更新 `updated_at`
- `steps.<step>.status=success` 前必须有可校验产物引用
- 当某步骤 `success` 且通过产物校验后，`task.status` 才可推进到对应主状态
- 审批步骤须记录到 `steps.approval`（含 `message_ts`〔Slack 原生 `ts` 字段〕、选择内容、操作者）
- 所有 `task.status`、`steps.*`、`revision`、`updated_at`、`history` 的状态写入必须通过 Orchestrator 的 `updateTask()` 完成。
- `updateTask()` 成功写入后必须生成一条 `TASK_UPDATED` outbox 事件；`orchestrator_meta.last_event_id` 可记录最近一次事件 ID 以便审计。

## 6. orchestrator_meta（可选）

建议结构：

```json
{
  "orchestrator_meta": {
    "last_event_id": "evt_...",
    "last_dispatcher_id": "dispatcher-main",
    "last_dispatched_at": "2026-05-11T16:30:00+09:00"
  }
}
```

该对象只记录总控运行元数据，不得替代 `task.status`、`steps` 或 outbox 事件表。
