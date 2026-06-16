# content-research 独立工具（不改 orchestrator）

## 定位

| 步骤 | 谁 | 产物 |
|------|-----|------|
| Step4b（现有） | `submit-pick` | `selected_topics.v1` + `selected_collect_items.v1` |
| **Step4c（本工具）** | OpenClaw **`content-research`** | `topic_research.v1`（内嵌 memo 格式 `research`） |

编排 Node 代码 **无需修改**；Slack `pick` 仍只跑 `submit-pick`。

## 前置

1. `openclaw gateway` 运行中  
2. `openclaw.json` 已注册 `content-research` 代理  
3. `GOOGLE_API_KEY`（或 agent 目录下 auth 已配置）

## 用法

```powershell
cd C:\Users\compu\.openclaw\publish-system

# 按 task_id 自动找 approve/selected_topics_*.json
node tools/content-research/run.mjs --task-id daily-20260519-r01

# 或显式指定 Step4 产物
node tools/content-research/run.mjs --selected-topics data\tasks\daily-20260519-r01\approve\selected_topics_20260519_r01.json

# 覆盖已有 topic_research
node tools/content-research/run.mjs --task-id daily-20260519-r01 --force
```

输出：`data/tasks/<task_id>/approve/topic_research_<JSTYYYYMMDD>_<runId>.json`

## 输入 / 输出契约

- **输入**：`selected_topics.v1` 的 `items[]`（`title` 必填）；可选读同任务 `selected_collect_items` 作 `collect_hint`。  
- **输出**：与 `docs/01_detailed_design/memo.md` 及 `topic_research.v1` schema 一致（见 `docs/00_basic_design/spec/schema_artifacts.md` §3.4）。

## 与 publish-orchestrator 的关系

- **不**占用 Slack binding；**不**在 `submit-pick` 内调 gateway。  
- 可由人工、cron 或日后单独脚本在 `manager_selected` 之后执行。  
- 跑完后会经 `updateTask` 自动写入 `task.json` → `steps.approve.research_ref`（与 outbox 一致，不改 orchestrator CLI）。
