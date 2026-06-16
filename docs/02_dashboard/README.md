# Dashboard 设计文档索引

Web 仪表盘（`frontend/` + `backend/`）方案文档。

| 文档 | 内容 |
|------|------|
| [tech-stack.md](./tech-stack.md) | **技术选型定稿**（前后端 + 中间件） |
| [development-plan.md](./development-plan.md) | **开发方案与实施顺序** |
| [design.md](./design.md) | 总体目标、数据流、分阶段交付 |
| [api-contract.md](./api-contract.md) | REST API 字段级契约 |
| [ui-pages.md](./ui-pages.md) | 页面布局、组件、路由 |
| [lan-production-deploy.md](./lan-production-deploy.md) | **本机生产部署 + 局域网访问**（单端口 8787） |

**当前范围**：S0～S4 已交付（只读仪表盘）；**S5 写操作列为后期备选**，选题/重试仍用 Slack。

实现入口：

- [`../../backend/README.md`](../../backend/README.md)
- [`../../frontend/README.md`](../../frontend/README.md)
