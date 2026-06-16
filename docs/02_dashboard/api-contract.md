# Dashboard API 契约（方案级）

Base URL 示例：`http://localhost:8787/api`（端口在 backend 配置中固定，实现时再定）。

所有时间字段：**ISO8601 + `Asia/Tokyo`**，与 `task.json` 一致。

---

## 通用约定

| 项 | 说明 |
|----|------|
| 格式 | JSON；`Content-Type: application/json` |
| 错误 | `{ "error": { "code": string, "message": string } }` |
| 分页 | `?limit=&offset=`（列表类接口，默认 limit=50） |
| 日期参数 | `date=YYYYMMDD` 或 `date=2026-06-09`（服务端统一转 JST 日界） |

---

## 1. 健康检查

### `GET /health`

**响应 200**

```json
{
  "ok": true,
  "instance_name": "default",
  "timezone": "Asia/Tokyo",
  "paths": {
    "tasks_dir": "...",
    "db_path": "...",
    "tasks_dir_readable": true,
    "db_readable": true
  },
  "server_time": "2026-06-09T15:00:00+09:00"
}
```

---

## 2. 按日任务

### `GET /days?from=YYYYMMDD&to=YYYYMMDD`

返回日期范围内**有任务**的日历摘要（用于历史列表 / 月历着色）。

**响应 200**

```json
{
  "days": [
    {
      "date": "2026-06-09",
      "task_ids": ["daily-20260609-r01"],
      "primary_task_id": "daily-20260609-r01",
      "status": "generating_copy",
      "step_summary": {
        "collect": "success",
        "tidy": "success",
        "approval": "success",
        "research": "success",
        "copy": "running",
        "image": "pending",
        "publish": "pending"
      },
      "updated_at": "2026-06-09T14:30:00+09:00",
      "is_terminal": false,
      "needs_human": false
    }
  ]
}
```

字段说明：

- `needs_human`：`status === awaiting_manager_selection`
- `is_terminal`：对齐 `taskStore.isTerminalStatus`

---

## 3. 任务详情

### `GET /tasks/:taskId`

**响应 200**：任务摘要 DTO（非完整 raw `task.json`，避免前端耦合 schema 细节）。

```json
{
  "task_id": "daily-20260609-r01",
  "run_id": "r01",
  "status": "topics_selected",
  "revision": 12,
  "degraded": false,
  "created_at": "...",
  "updated_at": "...",
  "steps": {
    "collect": { "status": "success", "started_at": "...", "finished_at": "...", "output_ref": "..." },
    "tidy": { "status": "success", "started_at": "...", "finished_at": "...", "output_ref": "..." },
    "approval": { "status": "success", "message_ts": "...", "output_ref": "..." },
    "research": { "status": "pending" },
    "copy": { "status": "pending" },
    "image": { "status": "pending" },
    "publish": { "status": "pending" }
  },
  "orchestrator_meta": {
    "last_event_id": "evt_...",
    "last_dispatched_at": "..."
  },
  "progress": {
    "percent": 45,
    "current_step": 5,
    "label": "调研"
  }
}
```

`progress` 为**展示用**计算字段，见 `design.md` §5.1。

### `GET /tasks/:taskId/raw`

可选调试端点：返回完整 `task.json`（一期可内网-only 或开发模式开启）。

---

## 4. 流程时间线

### `GET /tasks/:taskId/timeline`

**响应 200**

```json
{
  "task_id": "daily-20260609-r01",
  "events": [
    {
      "id": "hist-0",
      "at": "2026-06-09T09:00:01+09:00",
      "kind": "history",
      "title": "task_created",
      "detail": {},
      "operator": "orchestrator"
    },
    {
      "id": "step-collect-start",
      "at": "2026-06-09T09:00:05+09:00",
      "kind": "step_boundary",
      "title": "collect.started",
      "step": "collect"
    },
    {
      "id": "outbox-evt_abc",
      "at": "2026-06-09T09:15:00+09:00",
      "kind": "outbox",
      "title": "TASK_UPDATED",
      "revision": 5,
      "status": "done"
    }
  ]
}
```

`kind` 枚举：`history | step_boundary | outbox | system_log`（后两者 P2+）。

---

## 5. 产物摘要

### `GET /tasks/:taskId/artifacts/:step`

`:step` ∈ `collect | tidy | approve | generate | publish`

**响应 200**：按 `schema_artifacts.md` 解析后的**摘要**（非全量 JSON）。

示例 Step4：

```json
{
  "step": "approve",
  "schema_version": "selected_topics.v1",
  "summary": {
    "selected_count": 3,
    "topics": [{ "index": 2, "title": "..." }]
  },
  "artifact_path": "relative/to/tasks_dir/..."
}
```

### `GET /tasks/:taskId/files/*`

静态文件（如 `generate/images/*.png`）：仅允许 task 目录内路径；返回文件或 404。

---

## 6. Outbox（P2）

### `GET /outbox?status=pending,failed&task_id=`

**响应 200**

```json
{
  "events": [
    {
      "event_id": "evt_...",
      "event_type": "TASK_UPDATED",
      "task_id": "daily-20260609-r01",
      "run_id": "r01",
      "revision": 12,
      "status": "failed",
      "retry_count": 2,
      "created_at": "...",
      "processed_at": null
    }
  ],
  "counts": { "pending": 1, "processing": 0, "failed": 1, "done": 120 }
}
```

需在 `OutboxRepo` 新增：`listByFilter()`（当前仅有 consumer 向 `listReady`）。

---

## 7. 系统状态（P2）

### `GET /system/cron`

读取 `.openclaw/cron/jobs.json` 中与 publish 相关的 job 及最近 run 摘要。

### `GET /system/dispatch-log?date=YYYYMMDD`

 tail / 解析 `logs/cron-dispatch-YYYYMMDD.log`，返回结构化行（时间、action、task_id、结果）。

---

## 8. 写操作（P4，可选）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/tasks/:taskId/submit-pick` | body: `{ "picks": [2,5,8] }`，内部调 CLI 同等逻辑 |
| POST | `/tasks/:taskId/retry-step7` | body: `{ "platform": "x" }` |

均需：`Authorization: Bearer <token>` 或本机 loopback only。

---

## 9. backend 模块映射（实现时）

| API 路由 | backend 服务 | 复用 node 模块 |
|----------|--------------|----------------|
| `/days`, `/tasks/*` | `TaskService` | `taskStore`, `publishOrchestratorConfig` |
| `/tasks/*/timeline` | `TimelineService` | `TaskService` + `OutboxService` |
| `/outbox` | `OutboxService` | `OutboxRepo`（扩展） |
| `/system/*` | `SystemService` | fs 读 cron / logs |
