# 项目与目录说明（`.openclaw` + `publish-system`）

本文描述 **`C:\Users\compu\.openclaw`** 工作区内各顶层文件夹职责，并对 **`publish-system`** 做**子目录与主要文件**级说明。  
**规范真相**以 `docs/00_basic_design/` 下文档与 `node/src` 代码为准；仓库根 `README.md` 中部分「按目录名流转任务」的表述偏旧，**当前编排主线**为 **`data/tasks/<task_id>/task.json` + SQLite outbox + dispatcher**（见 `spec/event_outbox_and_dispatcher.md`）。

---

## 第一部分：`.openclaw` 根目录（工作区总览）

| 路径 | 说明 |
|------|------|
| **`openclaw.json`** | OpenClaw 主配置：agents、Slack 通道、`bindings`（如 Slack → `publish-orchestrator`）、gateway 等。 |
| **`agents/`** | 各 OpenClaw **角色定义目录**：`publish-orchestrator`、`my-daily` 等；子目录 **`agent/`** 放 `models.json`、认证配置；**`sessions/`** 存会话 JSONL。说明见 `agents/publish-orchestrator/agent/README.md`。 |
| **`workspace-publish-orchestrator/`** | **`publish-orchestrator` 的 workspace「家」**：`AGENTS.md`、`TOOLS.md`、`HEARTBEAT.md`、`SOUL.md`、`USER.md`、`IDENTITY.md` — 模型行为与 CLI 路径规则。 |
| **`workspace-my-daily/`**、**`workspace-analyzer-role/`** | 其他角色的 workspace（与本发布流水线可独立演进）。 |
| **`workspace/`** | 若存在，多为通用或历史 workspace 根（以实际内容为准）。 |
| **`publish-system/`** | **多平台发布与选题编排子项目**（本文重点，见下）。 |
| **`credentials/`**、**`devices/`**、**`identity/`**、**`memory/`**、**`logs/`**、**`cron/`**、**`completions/`**、**`canvas/`** | OpenClaw 运行时数据或能力扩展目录（凭据、设备配对、身份、记忆、日志等）；**不等同**于 `publish-system` 内 `data/` / `logs/`。 |

---

## 第二部分：`publish-system/` 总览

| 路径 | 说明 |
|------|------|
| **`README.md`** | 仓库级介绍与历史目录约定；**编排主线**请对照本文 + `00_basic_design`。 |
| **`config/`** | JSON 配置：采集源、路径、Slack 编排等（见下节）。 |
| **`data/`** | 任务落盘、认证态、素材、临时文件（见下节）。 |
| **`docs/`** | 设计与调试文档（**`00_basic_design`** 为当前主规范）。 |
| **`logs/`** | 采集、编排等运行日志（按子目录或文件名区分）。 |
| **`node/`** | **TypeScript 主程序**：编排器、采集 CLI、Tidy、Step4 Slack、发布（Playwright）等。 |
| **`openclaw/`** | 与 publish-system 相关的 OpenClaw **补充说明**（当前主要为遗留 **`analyzer`** 说明）。 |
| **`python/`** | **Python 采集/清洗**脚本与库（Tophub、聚合源等）；可由 Node 采集路径调用或独立运行。 |
| **`tmp/`** | 本地临时输出（若使用）。 |

---

## `publish-system/config/`

| 文件 | 说明 |
|------|------|
| **`paths.json`** | 数据根、日志根等路径映射（供 Node 读取）。 |
| **`collect_aggregate.json`** | 聚合类采集源配置（与 `collectors` 等配合）。 |
| **`collect_standalone.json`** | 独立源采集配置。 |
| **`tophub_channels.json`** | Tophub 频道列表等。 |
| **`orchestrator_slack.json`** | Step4 Slack：**频道 ID**、**`allowed_slack_user_ids`** 等（本地实例配置，勿提交密钥）。 |
| **`orchestrator_slack.example.json`** | 同上结构示例，可安全进版本库。 |

---

## `publish-system/data/`

| 路径 | 说明 |
|------|------|
| **`tasks/<task_id>/`** | **单任务根目录**：核心文件 **`task.json`**（状态机 SSOT、`steps.*`、`history` 等）。 |
| **`tasks/<task_id>/collect/`** | Step2 产出：`collect_result_<date>_<runId>.json`。 |
| **`tasks/<task_id>/tidy/`** | Step3 产出：`topic_candidates_<date>_<runId>.json`（`topic_candidates.v1`）。 |
| **`tasks/<task_id>/analyze/`** | 遗留 **`clean_result`** 等（旧分析路径兼容）。 |
| **`tasks/<task_id>/approve/`** | Step4 选题后：`selected_topics_*.json`、**`selected_collect_items_*.json`**。 |
| **`tasks/<task_id>/deep_collect/`**、**`generate/`**、**`publish/`** | Step5～7 规划产物目录（存在与否视实现进度）。 |
| **`auth/`** | Playwright **`storageState`** 等登录态（发布器使用）。 |
| **`assets/`** | 图片/视频等素材（路径约定见 `spec/naming_and_paths.md`）。 |
| **`system/`**、**`temp/`** | 系统级或临时数据（按项目约定使用）。 |

---

## `publish-system/docs/`

| 路径 | 说明 |
|------|------|
| **`00_basic_design/basic_design.md`** | 主设计：目标、架构、**Step1～7** 摘要、状态链、MUST 约束、规范索引。 |
| **`00_basic_design/spec/pipeline_steps_overview.md`** | **产品 Step1～7 总表**（与主设计 §3 对齐）。 |
| **`00_basic_design/spec/orchestrator_flow_step1_step7.md`** | 编排器与 executor **流程图**（与代码对齐）。 |
| **`00_basic_design/spec/schema_task.md`** | **`task.json`** 字段语义。 |
| **`00_basic_design/spec/schema_artifacts.md`** | 各阶段 **产物 JSON** schema（含 `selected_collect_items.v1`）。 |
| **`00_basic_design/spec/state_transitions_table.md`** | **`task.status`** 允许迁移矩阵。 |
| **`00_basic_design/spec/state_rules.md`** | 状态规则、partial、重跑等。 |
| **`00_basic_design/spec/naming_and_paths.md`** | 路径与文件命名。 |
| **`00_basic_design/spec/slack_protocol.md`** | Slack 模板与 `pick` 语法等。 |
| **`00_basic_design/spec/event_outbox_and_dispatcher.md`** | **Outbox + dispatcher**、`decideNextAction` 与代码对齐说明。 |
| **`00_basic_design/spec/steps/`** | **逐步骤详细设计**（产品 Step1～7；见 **下一节专表**）。 |
| **`00_basic_design/spec/roles/`** | 遗留 **`analyzer-role`** 合同与清单（主路径已不依赖分析角色）。 |
| **`00_basic_design/debug/step1_to_step7_e2e_checklist.md`** | E2E / 验收清单。 |
| **`01_detailed_design/`** | 更细设计文档（按主题子目录）。 |
| **`BK/`** | 备份/历史设计稿（`design`、`config` 等）。 |
| **`analyzer/`**、**`manager/`**、**`media/`**、**`publisher/`**、**`writer/`** | 按角色或子域拆分的说明文档（与主规范互补，以目录内 README 或 md 为准）。 |
| **`PROJECT_LAYOUT.md`** | **本文件**：全项目目录说明。 |

### `docs/00_basic_design/spec/steps/`（逐步骤设计）

路径：**`C:\Users\compu\.openclaw\publish-system\docs\00_basic_design\spec\steps`**。与 **`spec/pipeline_steps_overview.md`**、**`schema_artifacts.md`** 交叉引用；实现入口见 **`node/src`** 各 executor。

| 文件 | 对应产品 Step | 内容概要 |
|------|----------------|----------|
| **`step1_task_creation.md`** | Step1 | 创建 `task.json`、目录、首条 outbox；`created` → `collecting`。 |
| **`step2_collect.md`** | Step2 | 首轮话题采集；`collect_result`；`steps.collect`。 |
| **`step3_tidy.md`** | Step3 | **当前主路径**：从 `collect_result` 整理为 **`topic_candidates.v1`**（本地 Tidy，无 LLM）。 |
| **`step3_analyze.md`** | （历史） | **仅占位/迁移说明**：指向 **`step3_tidy.md`**；旧「分析角色 + clean_result」主路径已废弃。 |
| **`step4_slack_selection.md`** | Step4 | Slack 发帖、`pick` 协议、**`submit-pick`** 固化 **`selected_topics`** + **`selected_collect_items`**；与 `step4SlackNotify` / `step4ApplyPick` 对齐。 |
| **`step5_deep_collect.md`** | Step5 | 按选题 **二次采集**；`deep_collect_result`；dispatcher 侧待接入说明。 |
| **`step6_generation.md`** | Step6 | **文案 + 图片** 生成；`copy_result` / `image_result`；待接入说明。 |
| **`step7_publish.md`** | Step7 | 多平台 **发布** 与 `publish_result`；待接入说明。 |

---

## `publish-system/logs/`

| 说明 |
|------|
| 运行期日志，例如 **`logs/collector/`** 下 Step2 采集按任务命名的 log；编排器日志路径以 `spec/naming_and_paths.md` 或代码为准。 |

---

## `publish-system/node/`（TypeScript 应用）

| 路径 | 说明 |
|------|------|
| **`package.json`** | 依赖与脚本：`orchestrator`、`collect`、`publish`、`login`、`typecheck`。 |
| **`tsconfig.json`** | TypeScript 编译配置。 |
| **`src/cli/orchestrator.ts`** | **编排 CLI**：`create-task`、`dispatch-once` / `run-once`、`submit-pick`、`materialize-collect` 等。 |
| **`src/cli/collect.ts`** | 采集 CLI 入口（任务模式采集）。 |
| **`src/cli/publish.ts`** | 发布 CLI（Playwright 发布器）。 |
| **`src/cli/login.ts`** | 各平台登录态生成。 |
| **`src/orchestrator/`** | **`dispatcher.ts`**（消费 outbox）、**`decideNextAction.ts`**、**`updateTask.ts`**、**`createTask.ts`**、**`taskStore.ts`**、**`transitionGuard.ts`**、**`outboxRepo.ts`**、**`reconcile.ts`**、**`orchestratorSlackConfig.ts`** 等。 |
| **`src/executors/step2Collect.ts`** | Step2 采集执行。 |
| **`src/executors/stepTidyFromCollect.ts`** | 调度 **Tidy**（Step3）。 |
| **`src/tidy/`** | **`runner.ts`**：`collect_result` → **`topic_candidates.v1`**。 |
| **`src/executors/step4SlackNotify.ts`** | Step4：读候选、组 Slack 正文、**direct / dry_run** 发帖路径。 |
| **`src/executors/step4RoleDispatch.ts`** | Step4 **role 模式**：网关调 OpenClaw、拼 JSON 指令、解析 ACK。 |
| **`src/executors/step4ApplyPick.ts`** | **`submit-pick`** → **`applyManagerPick`**：`selected_topics` + **`selected_collect_items`**。 |
| **`src/executors/materializeSelectedCollect.ts`** | **`materialize-collect`**：`manager_selected` 下补写 collect 切片。 |
| **`src/collect/`** | 采集 **`runner`**、**`sources/`**（tophub、rss、reddit、hackerNews、googleTrends、standalone）、配置与类型。 |
| **`src/analyze/`** | OpenClaw **Sessions 客户端**、网关配置（Step4 role 与历史 analyzer 调用共用基础设施）。 |
| **`src/api/`** | 若启用 HTTP API（见 `index.ts`）。 |
| **`src/publish/`**、**`src/core/`** | 发布器与任务加载、账号、产物等 **Playwright 发布链路**。 |

---

## `publish-system/openclaw/`

| 路径 | 说明 |
|------|------|
| **`analyzer/AGENTS.md`** | 与 **analyzer 角色**相关的说明（**主路径 Step3 已为 Node Tidy**，此处多为历史/兼容参考）。 |

---

## `publish-system/python/`

| 路径 | 说明 |
|------|------|
| **`collectors/`** | 各平台/源采集实现基类与具体 collector。 |
| **`cleaners/`**、**`analyzers/`** | 清洗与分析脚本（历史或辅助管线）。 |
| **`core/`**、**`services/`**、**`steps/`** | 公共逻辑、服务封装、步骤脚本。 |
| **`tmp/`**（若存在） | Python 侧临时输出。 |

---

## 维护建议

- **新增 executor 或 CLI 子命令**：在本文件 **`node/`** 小节补一行，并在 `spec/orchestrator_flow_step1_step7.md` 更新。  
- **新增产物类型**：更新 **`spec/schema_artifacts.md`** 与本文件 **`data/`** 小节。  
- **OpenClaw 角色行为**：以 **`workspace-publish-orchestrator/AGENTS.md`** 为准，本文件仅作仓库结构索引。

---

*生成说明：本布局基于当前仓库目录扫描整理；若你增删目录，请同步更新本文件。*
