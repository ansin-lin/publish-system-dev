# publish-system 配置

## 编排主配置（唯一运行时入口）

| 文件 | 说明 |
|------|------|
| **`publish.orchestrator.json`** | **必填**。编排器只读此文件（路径、Slack、平台、Step1–7、stale 等） |
| **`publish.orchestrator.example.commented.jsonc`** | 带注释的字段说明模板（**代码不读**；新建实例时参考） |

### 首次使用

```powershell
cd C:\Users\compu\.openclaw\publish-system\config
# 参考 publish.orchestrator.example.commented.jsonc 创建并编辑：
#   publish.orchestrator.json
```

本机 `publish.orchestrator.json` 含频道 ID 等，**建议不要提交 git**。

### 校验

```powershell
cd C:\Users\compu\.openclaw\publish-system\node
npm run config:check
```

### 顶层字段

| 字段 | 说明 |
|------|------|
| `schema_version` | 配置文件**结构**版本 |
| `config_version` | **业务**配置版本 |
| `strict` | `true`：未知字段报错；`false`：仅警告 |
| `timezone` | 任务与日期目录，默认 `Asia/Tokyo` |
| `instance_name` | 多机部署标识 |

### 路径解析

- `paths` 下所有 `./` 路径相对 **`publish-system/`** 根目录，不使用 `process.cwd()`。
- Step2 子配置路径由 `step2.aggregate_config_path` 等指向（见下）。

### 环境变量（密钥，不在 JSON）

| 环境变量 | 覆盖的配置 |
|----------|------------|
| `SLACK_BOT_TOKEN` | Step4 node（发帖/轮询）+ step_completion |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Step6 Node AI 配图 |
| `PUBLISH_ORCH_STEP_NOTIFY` | `slack.step_completion.enabled` |
| `PUBLISH_ORCH_STEP4_DELIVERY` | `slack.step4.delivery` |
| `PUBLISH_ORCH_SLACK_CHANNEL_ID` | `slack.channel_id` |
| `PUBLISH_ORCH_SLACK_ALLOWED_USERS` | `slack.allowed_user_ids` |
| 等 | 见 `node/src/orchestrator/envOverrides.ts` |

### OpenClaw（不在本文件）

Step4 发帖与收 pick 由 **Node** 完成（`slack.step4.delivery: node`，`pick_receive.mode: poll`）。Step5/6 仍用 OpenClaw Gateway（`~/.openclaw/openclaw.json`）。

### Step4 生产切换检查清单

- [ ] `publish.orchestrator.json` → `slack.step4.delivery: "node"`，`pick_receive.mode: "poll"`
- [ ] `SLACK_BOT_TOKEN` 在运行 `dispatch-run-once.ps1` 的账户下可用
- [ ] Bot 已加入 `slack.channel_id` 频道；Scope：`chat:write`、`channels:history`（或 `groups:history`）
- [ ] **不要**再设置 `PUBLISH_ORCH_STEP4_DELIVERY=role`（已废弃）
- [ ] OpenClaw Gateway 仍常驻（Step5/6）；`workspace-publish-orchestrator/AGENTS.md` 已注明 Step4 不由 Agent 处理

## 其它配置（由主配置引用，非兜底）

主配置 `step2.*_config_path` 指向以下文件，内容为采集业务规则：

| 文件 | 说明 |
|------|------|
| `collect_aggregate.json` | 聚合源平台与条数 |
| `collect_standalone.json` | 独立源（reddit、tophub 等） |
| `tophub_channels.json` | Tophub 频道映射 |

设计说明：[`docs/00_basic_design/spec/steps/step4_slack_selection.md`](../docs/00_basic_design/spec/steps/step4_slack_selection.md)

## 已移除的旧文件

`paths.json`、`orchestrator_slack.json` 已删除；对应项请只写在 `publish.orchestrator.json` 的 `paths` 与 `slack` 中。
