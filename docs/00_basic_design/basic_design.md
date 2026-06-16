# 热点内容生产与发布总控系统（Publish Orchestrator）基础设计 v2.1

## 1. 系统目标
构建一个由总控统一编排的 7 步流水线，实现从选题到发布的可追踪闭环：

1. 任务创建
2. 话题采集
3. 话题整理（Tidy）
4. Slack 人工选题
5. 选题研究（topic_research）
6. 文案与配图生成
7. 多平台发布与回执

---

## 2. 总体架构
系统采用“总控状态机 + 执行器 + 事件驱动”的分层设计：

- **总控层（Orchestrator）**：状态推进、异常处理、人工交互编排
- **执行层（Executors/Roles）**：Step2 采集、Step3 Tidy、Step5 研究、Step6 生成、Step7 发布
- **协同层（Data Contracts）**：统一 JSON 输入输出与 schema 约束
- **交互层（Human-in-the-loop）**：Slack 选题与审批
- **观测层（Audit & Metrics）**：任务轨迹、失败原因、重试记录、发布回执

> v2.1 重点：统一状态语义、统一步骤边界、统一事件驱动机制。

---

## 3. 核心流程（Step1~Step7）

| 步骤 | 名称 | 主要结果 | 阶段结束状态 |
|---|---|---|---|
| Step1 | 任务创建 | `task.json`、任务目录、首条 outbox 事件 | `collecting` |
| Step2 | 话题采集 | `collect/collect_result*.json` | `collected` |
| Step3 | 话题整理（Tidy） | `tidy/topic_candidates*.json` | `collected`（状态不变） |
| Step4 | Slack 选题 | `approve/selected_topics*.json` | `topics_selected` |
| Step5 | 选题研究 | `approve/topic_research*.json` | `research_done` |
| Step6 | 文案与配图生成 | `generate/copy_result*.json`、`generate/image_result*.json` | `image_generated` |
| Step7 | 发布 | `publish/publish_result*.json` | `published` / `publish_partial_failed` |

### 关键边界
- **Step4 仅做选题，不生成 topic_research**。
- **Step5 才生成 topic_research**。
- `submit-pick` 仅完成 Step4；Step5/6 由 dispatcher 或 run-once 推进。

---

## 4. 状态机（统一口径）

### 主流程状态
`created -> collecting -> collected -> awaiting_manager_selection -> topics_selected -> generating_research -> research_done -> generating_copy -> copy_generated -> generating_image -> image_generated -> publishing -> published`

### 终止/异常状态
- `failed`
- `publish_partial_failed`
- `approval_timeout`
- `cancelled`
- `aborted`

### 遗留状态（`transitionGuard` 仍允许，非新任务主路径）

- **`manager_selected`**：旧 Step5 结束态名；新任务 Step5 结束为 **`research_done`**。`decideNextAction` 在已有 `topic_research` 时仍可从 `manager_selected` 进入 Step6。

> **`analyzing` / `analyzed` / `deep_collecting` / `deep_collected`** 已从编排代码移除（2026-06）。磁盘上若存在旧任务目录或产物，需人工迁移或废弃，编排器不再自动推进这些状态。

---

## 5. 模块职责

1. **Orchestrator**：唯一状态写入口调度者；不做业务内容生成
2. **Step2 Collect Executor**：采集并输出 collect_result
3. **Step3 Tidy Executor**：由 collect_result 生成编号候选 topic_candidates（替代 analyzer 主路径）
4. **Step4 Approval/Slack Executor**：通知、接收 pick、落盘 selected_topics
5. **Step5 Research Executor（content-research）**：基于 selected_topics 生成 topic_research
6. **Step6 Generation Executors（content-copy / image）**：生成文案与图片
7. **Step7 Publish Executor**：多平台发布、回执汇总与部分失败归因

---

## 6. v2.1 事件驱动机制（Outbox + Dispatcher）

1. **`task.json` 是 SSOT**：任务与步骤状态、产物引用、审计历史以 task.json 为准
2. **`outbox_events` 仅是通知层**：不能反推任务真实状态
3. **`updateTask()` 是唯一状态写入口**：所有 `task.status`/`steps.*`/`revision`/`updated_at`/`history` 变更必须经此完成
4. **`dispatcher` 是唯一事件推进器**：负责消费事件、重读 task、决定下一动作
5. **消费前必须重读最新 task**：不能信任 event payload 中的状态快照
6. **事件可重复投递，消费必须幂等**：依赖 `event_id`、`revision` 与产物存在性校验

---

## 7. 不可违背约束（MUST）

1. 所有状态变化必须通过 `updateTask()` 写回 `task.json`
2. 每次状态变更必须 `revision + 1`，并产生 `TASK_UPDATED` 事件
3. 先更新 `steps`，再推进 `task.status`
4. Step4 结束条件是 `selected_topics` 落盘，不包含 Step5
5. Executor 只负责执行步骤与返回 `steps.<step>` 结果，不得直接推进 `task.status`；任务主状态只能由 Orchestrator 通过 `updateTask()` 推进
6. 重跑必须使用新 `run_id`，禁止回改旧 run 状态
7. 命名与路径统一遵循 `spec/naming_and_paths.md`
8. 时间字段统一 ISO8601 + `Asia/Tokyo`

---

## 8. 规范索引（Normative References）

- `spec/pipeline_steps_overview.md`
- `spec/orchestrator_flow_step1_step7.md`
- `spec/state_transitions_table.md`
- `spec/state_rules.md`
- `spec/schema_task.md`
- `spec/schema_artifacts.md`
- `spec/naming_and_paths.md`
- `spec/slack_protocol.md`
- `spec/step_completion_slack_notify.md`（Step1～7 完成单向 Slack）
- `spec/step6_stock_images.md`（Step6 今日/Common/AI 配图）
- `spec/event_outbox_and_dispatcher.md`

---

## 9. 回退设计（Rollback）

### 9.1 设计目标
当流程在 Step2~Step7 任一步骤出现失败、超时、人工驳回、外部依赖异常等情况时，系统必须支持可审计、可幂等、可重复执行的回退机制，避免任务卡死、状态漂移和产物污染。

### 9.2 回退范围
- **任务状态回退**：将 `task.status` 回退到可重试节点（如 `collected`、`topics_selected`、`research_done`、`image_generated`）
- **步骤状态回退**：对指定 `steps.<step>` 标记为 `rolled_back` 或重置为 `pending`
- **产物回退**：通过“软失效（superseded/invalidated）”而非物理删除管理旧产物
- **事件回退**：对已出队但未生效事件进行幂等忽略，对已生效事件通过补偿事件修正

### 9.3 基本原则
1. 回退必须通过 `updateTask()` 完成，禁止直接改写 `task.json`
2. 回退动作必须记录 `history`（操作者、原因、来源事件、前后状态）
3. 回退优先采用“前滚补偿”而非“文件回档”
4. 回退后必须保证 dispatcher 可继续推进，不产生死循环
5. 回退与重试必须使用新的 `run_id`

### 9.4 触发方式
- **自动触发**：达到重试上限、发布部分失败且策略要求回退、依赖服务不可用
- **人工触发**：管理员在控制面发起指定任务/指定步骤回退
- **策略触发**：依据状态机规则与失败类型映射触发

### 9.5 与状态机关系
回退不改变主状态机的“正向定义”，而是作为异常治理路径存在；回退完成后，任务需落在一个“可继续正向推进”的合法状态。

### 9.6 实现说明
僵死步骤回退与重试见代码 `node/src/orchestrator/reconcileStaleSteps.ts`，配置见 `publish.orchestrator.json` → `orchestrator.stale`；状态规则见 `spec/state_rules.md`。

---

> 本文描述“系统是什么”；具体字段、状态表、执行细节以 spec 子文档为准。