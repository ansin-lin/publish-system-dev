# 多平台发布编排（Node.js + Playwright）

按流水线 **Step1～Step7** + `shared` / `orchestrator` 拆分的 TypeScript 应用。旧版平铺结构在 `../node-old/` 保留作对照。

## 目录

```
src/
  shared/           # 配置、runner、OpenClaw 客户端
  orchestrator/     # 状态机、dispatcher、outbox
  step1-create/ … step7-publish/
  cli/              # login、collect、orchestrator、publish
  scripts/          # 单平台测试入口
platforms/          # 各平台 publish/login
```

## 安装

```powershell
npm install
npm run install:browsers
```

## 常用命令

```powershell
npm run orchestrator -- create-task
npm run orchestrator -- run-once
npm run orchestrator -- publish-task --task-id <id> --platforms x,facebook
npm run publish -- --job ../data/tasks/<id>/publish/publish_job_*.json --platforms x
npm run test:x-publish
npm run test:fb-publish
```

数据与日志路径见 `publish.config.json`（`../data`、`../logs`，与 `node-old` 共用）。
