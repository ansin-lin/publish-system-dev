# Dashboard UI 页面规格（方案级）

技术栈建议见 `frontend/README.md`。本文只定义信息架构与组件，不写具体组件代码。

---

## 1. 路由

| 路径 | 页面 | 阶段 |
|------|------|------|
| `/` | 每日总览（默认今天 JST） | P1 |
| `/day/:date` | 指定日期总览（`:date` = `YYYY-MM-DD`） | P2 |
| `/task/:taskId` | 任务详情 + 流程时间线 | P1 |
| `/system` | Outbox + Cron + Dispatch 日志 | P2 |

---

## 2. 页面 A：每日总览 `/`

### 布局

```text
┌─────────────────────────────────────────────────────────┐
│  Header: 发布流水线仪表盘    [日期选择器 ◀ 今天 ▶]        │
├─────────────────────────────────────────────────────────┤
│  SystemHealthBar (P2): cron OK | outbox pending: 0      │
├─────────────────────────────────────────────────────────┤
│  DailyTaskCard                                          │
│    task_id · status badge · degraded?                   │
│    StepProgressBar (7 steps)                            │
│    关键时间: 创建 | 采集完成 | 选题 | 发布完成            │
│    [查看详情 →]                                          │
├─────────────────────────────────────────────────────────┤
│  EmptyState: 当日无任务时提示「等待 09:00 创建」         │
└─────────────────────────────────────────────────────────┘
```

### 组件：`StepProgressBar`

- 7 个节点：创建 → 采集 → 整理 → 选题 → 调研 → 生成 → 发布
- 节点颜色：`pending` 灰 / `running` 蓝脉冲 / `success` 绿 / `failed` 红 / `partial_failed` 橙
- Step6 需合并 `copy` + `image`：两者皆 success 才标绿；任一 running 则 Step6 running
- `awaiting_manager_selection`：Step4 节点显示「等待人工」图标

### 数据依赖

- `GET /days?from=&to=` 或 `GET /tasks/:taskId`（当日 primary task）

---

## 3. 页面 B：任务详情 `/task/:taskId`

### 布局

```text
┌─────────────────────────────────────────────────────────┐
│  Breadcrumb: 总览 / daily-20260609-r01                  │
├──────────────────────┬──────────────────────────────────┤
│  TaskSummaryPanel    │  EventTimeline (主栏)             │
│  status, revision    │  垂直时间线，最新在上或下可配置    │
│  steps 表格          │  每条: 时间 | 类型 | 标题 | 展开   │
│  人工卡点 Alert      │                                   │
├──────────────────────┴──────────────────────────────────┤
│  StepDetailTabs: 采集 | 整理 | 选题 | 调研 | 生成 | 发布  │
│    每 Tab: ArtifactSummary + 错误信息 + 链接 raw JSON     │
└─────────────────────────────────────────────────────────┘
```

### 组件：`EventTimeline`

| `kind` | 图标 | 展示 |
|--------|------|------|
| `history` | 圆点 | `event` + `operator` |
| `step_boundary` | 方点 | `step.started` / `step.finished` |
| `outbox` | 菱形 | `TASK_UPDATED` + revision |
| `system_log` | 虚线 | dispatch 一行摘要 |

### 组件：`HumanGateAlert`

当 `status === awaiting_manager_selection`：

- 文案：请在 Slack 频道回复 `pick 2,5,8`
- 显示候选数量（来自 artifact 摘要或 step output）
- P4：可选「在 Web 提交选题」按钮

当 `status === publish_partial_failed`：

- 列出失败平台 + 成功平台
- 提示 Slack `retry <platform>`

### 数据依赖

- `GET /tasks/:taskId`
- `GET /tasks/:taskId/timeline`
- `GET /tasks/:taskId/artifacts/:step`（Tab 切换时懒加载）

---

## 4. 页面 C：系统运维 `/system`（P2）

```text
┌─────────────────────────────────────────────────────────┐
│  OutboxQueueTable: status 筛选 | task_id 搜索           │
│  CronJobsTable: publish-daily-create / dispatch-run-once│
│  DispatchLogViewer: 按日 tail，可折叠原始行               │
└─────────────────────────────────────────────────────────┘
```

---

## 5. 全局 UX 约定

| 项 | 约定 |
|----|------|
| 时区 | 所有展示时间带 `JST` 或 `+09:00` |
| 刷新 | P1 轮询 60s；页面标题旁显示「上次更新」 |
| 加载 | 骨架屏；timeline 分页或虚拟滚动（history 很长时） |
| 错误 | API 失败时 Banner + 重试；区分「无任务」与「服务不可用」 |
| 终端态 | `published` 绿 / `failed` 红 / `approval_timeout` 黄 |

---

## 6. 前端目录与页面对应

| 路径 | 文件（规划） |
|------|-------------|
| `/` | `src/pages/DailyOverviewPage.tsx` |
| `/day/:date` | 同上，date 来自路由 |
| `/task/:taskId` | `src/pages/TaskDetailPage.tsx` |
| `/system` | `src/pages/SystemPage.tsx` |
| 共享 | `src/components/StepProgressBar.tsx`, `EventTimeline.tsx`, ... |
| API | `src/api/client.ts`, `src/api/hooks/useTask.ts` |

---

## 7. 状态枚举同步

前端**不硬编码**业务状态列表：

- P1：从 `GET /health` 或静态 `constants` 文件由 backend 生成（P2 可加 `GET /meta/enums`）
- 与 `state_transitions_table.md` 保持同步的责任在 backend DTO 层
