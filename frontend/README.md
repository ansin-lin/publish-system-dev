# publish-system/frontend — Dashboard Web UI

每日任务进度与流程记录的 Web 展示层，通过 `backend` REST API 获取数据。

完整方案见 [`docs/02_dashboard/`](../docs/02_dashboard/design.md)。  
**生产构建与局域网部署**见 [`docs/02_dashboard/lan-production-deploy.md`](../docs/02_dashboard/lan-production-deploy.md)（`npm run build` 后由 backend 托管）。

---

## 职责边界

| 做 | 不做 |
|----|------|
| 展示 7 步进度、时间线、产物摘要 | 直接读本地 `data/tasks/`（不经 backend） |
| 日期切换、轮询刷新 | 调用 orchestrator CLI |
| P4 可选：提交选题 / 重试发布 | 持有 Slack token 或 OpenClaw 密钥 |

---

## 技术选型（定稿）

详见 [`docs/02_dashboard/tech-stack.md`](../docs/02_dashboard/tech-stack.md)。

| 项 | 选型 |
|----|------|
| 构建 | **Vite** 6.x |
| 语言 | **TypeScript** 5.8+ |
| UI 框架 | **React** 19 |
| 路由 | **React Router** 7.x |
| 数据请求 | **TanStack Query** v5 + fetch |
| 样式 | **Tailwind CSS** 4.x |
| 基础 UI | **shadcn/ui**（可选：Table、Badge、Alert、Skeleton） |
| 日期 | **date-fns** + **date-fns-tz**（JST） |

开发期 Vite proxy：`/api` → `http://127.0.0.1:8787`（backend）。

---

## 目录结构（规划）

```text
frontend/
  README.md
  package.json
  vite.config.ts
  index.html
  .env.example              # VITE_API_BASE_URL
  public/
  src/
    main.tsx                # 入口
    App.tsx                 # 路由壳
    pages/
      DailyOverviewPage.tsx # / 与 /day/:date
      TaskDetailPage.tsx    # /task/:taskId
      SystemPage.tsx        # /system (P2)
    components/
      layout/
        AppHeader.tsx
        AppLayout.tsx
      task/
        DailyTaskCard.tsx
        StepProgressBar.tsx
        TaskStatusBadge.tsx
        HumanGateAlert.tsx
      timeline/
        EventTimeline.tsx
        TimelineItem.tsx
      system/
        OutboxQueueTable.tsx
        CronJobsTable.tsx
      common/
        DatePicker.tsx
        LoadingSkeleton.tsx
        ErrorBanner.tsx
    api/
      client.ts             # fetch 封装、base URL
      endpoints.ts          # 路径常量
      hooks/
        useDailyTask.ts
        useTaskDetail.ts
        useTimeline.ts
        usePolling.ts
    types/
      task.ts               # 对齐 api-contract DTO
      timeline.ts
    utils/
      formatJst.ts
      stepStatusColor.ts
    styles/
      global.css
```

---

## 页面与路由

详见 [`ui-pages.md`](../docs/02_dashboard/ui-pages.md)。

| 路由 | 页面 | 阶段 |
|------|------|------|
| `/` | 今日总览 | P1 |
| `/day/:date` | 指定日期 | P2 |
| `/task/:taskId` | 详情 + 时间线 | P1 |
| `/system` | 运维面板 | P2 |

---

## 环境变量（规划）

| 变量 | 说明 | 默认 |
|------|------|------|
| `VITE_API_BASE_URL` | API 根路径 | 开发：`/api`（proxy）；生产：同源 `/api` |

---

## 开发命令（占位，实现时写入 package.json）

```bash
cd publish-system/frontend
npm install
npm run dev       # 默认 http://localhost:5173
npm run build
npm run preview
```

同时启动 backend：

```bash
cd publish-system/backend && npm run dev
```

---

## 实现顺序

1. `api/client` + `DailyOverviewPage` 空壳 + `StepProgressBar` 静态 mock
2. 对接 `GET /tasks/:id`、`GET /days`
3. `TaskDetailPage` + `EventTimeline`
4. 60s 轮询 + 错误态
5. P2：`SystemPage`、历史日期、Outbox 表
6. P3：产物 Tab、图片预览

---

## 相关文档

- [本机生产 + 局域网部署](../docs/02_dashboard/lan-production-deploy.md)
- [技术选型（定稿）](../docs/02_dashboard/tech-stack.md)
- [UI 页面规格](../docs/02_dashboard/ui-pages.md)
- [API 契约](../docs/02_dashboard/api-contract.md)
