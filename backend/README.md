# publish-system/backend — Dashboard API（BFF）

只读聚合层：为 Web 仪表盘提供 REST API，**不替代** `node/` 编排器执行逻辑。

完整方案见 [`docs/02_dashboard/`](../docs/02_dashboard/design.md)。  
**本机生产 + 局域网部署**见 [`docs/02_dashboard/lan-production-deploy.md`](../docs/02_dashboard/lan-production-deploy.md)。

---

## 职责边界

| 做 | 不做 |
|----|------|
| 读 `task.json`、outbox、日志、cron 状态 | 写 `task.json`、插入 outbox（P1） |
| 合并 timeline、计算 progress 展示字段 | 跑 dispatcher / Step executor |
| serve task 目录内产物文件（受路径校验） | 暴露 auth / Gateway token |
| P4 可选：封装 submit-pick / retry-step7 | 修改 `node/` CLI 行为 |

---

## 技术选型（定稿）

详见 [`docs/02_dashboard/tech-stack.md`](../docs/02_dashboard/tech-stack.md)。

| 项 | 选型 |
|----|------|
| 运行时 | Node.js ≥20（与 `node/` 一致） |
| 语言 | TypeScript（ESM，`strict: true`） |
| 开发运行 | tsx watch |
| HTTP | **Hono** + **@hono/node-server** |
| 校验 | **Zod** + **@hono/zod-validator** |
| 中间件 | `@hono/cors`、`@hono/logger`、`@hono/secure-headers`、统一 errorHandler |
| 配置 | `../config/publish.orchestrator.json` + `publishOrchestratorConfig.ts` |
| 数据库 | 只读 `orchestrator.db`（`node:sqlite` / `OutboxRepo` 扩展） |
| 日志 | pino（或初期 console） |
| 端口 | **8787**；生产可 `serveStatic(frontend/dist)` |

### 与 `node/` 的代码复用方式（实现时二选一）

1. **Monorepo 相对 import**：backend `tsconfig` paths 指向 `../node/src/...`（开发快，耦合路径）
2. **抽 shared 包**：将 `taskStore`、`OutboxRepo`、config loader 抽到 `publish-system/shared/`（长期更干净）

一期建议方式 1，待 dashboard 稳定后再抽 shared。

---

## 目录结构（规划）

```text
backend/
  README.md                 # 本文件
  package.json              # 实现时添加
  tsconfig.json
  .env.example              # DASHBOARD_PORT, DASHBOARD_TOKEN（P4）
  src/
    index.ts                # HTTP 入口、启动
    config/
      dashboardConfig.ts    # 端口、CORS、openclaw 根路径（cron）
    api/
      routes/               # 按资源拆分路由
        health.ts
        days.ts
        tasks.ts
        timeline.ts
        artifacts.ts
        outbox.ts
        system.ts
      middleware/
        errorHandler.ts
        cors.ts
        auth.ts              # P4
    services/
      taskService.ts        # listTaskJsonPaths, 按日过滤, DTO 映射
      outboxService.ts      # 扩展查询 + counts
      timelineService.ts    # history + steps + outbox 合并
      artifactService.ts    # 读产物 JSON 摘要
      systemService.ts      # cron + dispatch log
    types/
      dto.ts                # API 响应类型（对齐 api-contract.md）
    utils/
      dateJst.ts            # YYYYMMDD 解析
      pathGuard.ts          # 防目录穿越
```

---

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `DASHBOARD_PORT` | 监听端口 | `8787` |
| `DASHBOARD_HOST` | 绑定地址；局域网用 `0.0.0.0` | `127.0.0.1` |
| `DASHBOARD_SERVE_STATIC` | 托管 `frontend/dist` | 有 `dist/index.html` 时自动开启 |
| `OPENCLAW_ROOT` | `.openclaw` 根目录（读 cron） | 自动推断 |
| `PUBLISH_ORCHESTRATOR_CONFIG` | 主配置路径 | `../config/publish.orchestrator.json` |
| `DASHBOARD_CORS_ORIGINS` | 跨域（分端口部署时） | localhost:5173 |
| `DASHBOARD_TOKEN` | P4 写操作 Bearer token | 空 = 仅只读 |

示例：[`backend/.env.example`](./.env.example)

### 生产启动（局域网）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\start-dashboard-prod.ps1
```

详见 [lan-production-deploy.md](../docs/02_dashboard/lan-production-deploy.md)。

---

## 开发命令（占位，实现时写入 package.json）

```bash
cd publish-system/backend
npm install
npm run dev      # tsx watch src/index.ts
npm run typecheck
```

---

## 实现顺序

1. `config` + `health` + `TaskService.getById`
2. `GET /days`、`GET /tasks/:id`
3. `TimelineService` + `GET /tasks/:id/timeline`
4. `OutboxService.listByFilter`（需改 `node/.../outboxRepo.ts` 或 backend 内只读 SQL）
5. `SystemService` + cron / dispatch log
6. `ArtifactService` + 静态文件 route

---

## 相关文档

- [本机生产 + 局域网部署](../docs/02_dashboard/lan-production-deploy.md)
- [技术选型（定稿）](../docs/02_dashboard/tech-stack.md)
- [API 契约](../docs/02_dashboard/api-contract.md)
- [task.json schema](../docs/00_basic_design/spec/schema_task.md)
- [Outbox 设计](../docs/00_basic_design/spec/event_outbox_and_dispatcher.md)
