# 任务状态迁移表（task.status）

本文档描述 **`task.json` 中 `task.status` 的允许迁移**（与代码一致），并给出 **Step1～Step7 业务链路** 与状态的映射及实现注意点。

- **代码权威来源**：`node/src/orchestrator/transitionGuard.ts`（`ALLOWED_TRANSITIONS`）
- **写入规则**：`state_rules.md` — 变更须经 `updateTask()`，先 `steps` 后 `task.status`（语义上）

---

## 1. 允许迁移矩阵（当前实现）

行 = 当前 `task.status`，列 = 允许进入的下一状态（无序集合，以列表展示）。

| 当前状态 | 允许迁移到 |
|----------|------------|
| `created` | `collecting`, `cancelled`, `failed` |
| `collecting` | `collected`, `failed`, `aborted`, `cancelled` |
| `collected` | `awaiting_manager_selection`, `failed`, `aborted`, `cancelled` |
| `analyzing` | `collected`, `analyzed`, `failed`, `aborted`, `cancelled` |
| `analyzed` | `awaiting_manager_selection`, `failed`, `aborted`, `cancelled`, `analyzing`, `collected` |
| `awaiting_manager_selection` | `manager_selected`, `approval_timeout`, `failed`, `aborted`, `cancelled` |
| `manager_selected` | `deep_collecting`, `failed`, `aborted`, `cancelled` |
| `deep_collecting` | `deep_collected`, `failed`, `aborted`, `cancelled` |
| `deep_collected` | `generating_copy`, `failed`, `aborted`, `cancelled` |
| `generating_copy` | `copy_generated`, `failed`, `aborted`, `cancelled` |
| `copy_generated` | `generating_image`, `failed`, `aborted`, `cancelled` |
| `generating_image` | `image_generated`, `awaiting_publish_review`, `copy_generated`, `failed`, `aborted`, `cancelled` |
| `image_generated` | `publishing`, `awaiting_publish_review`, `failed`, `aborted`, `cancelled` |
| `awaiting_publish_review` | `image_generated`, `revising_copy`, `cancelled`, `failed`, `aborted` |
| `revising_copy` | `awaiting_publish_review`, `cancelled`, `failed`, `aborted` |
| `publishing` | `published`, `publish_partial_failed`, `failed`, `aborted`, `cancelled` |

说明：

- 上表未列出 `from -> to` 当 `from === to` 的情况：`assertValidTransition` 对相同状态 **不校验**（允许无操作写入其他字段）。
- `failed` / `cancelled` / `aborted` 等作为源状态 **未在表中声明出边**：若需从终态恢复，须通过新 `run_id` 或单独产品规则扩展（见 `state_rules.md` 重跑语义）。
- `analyzing` / `analyzed` 主要为 **旧任务兼容**；新建任务默认路径为 `collected` →（Step3 Tidy）→ Step4 → `awaiting_manager_selection`，**不**再经过 `analyzer-role`。

---

## 2. 迁移明细表（边列表）

便于检索与评审；与 §1 等价。

| # | from | to | 备注（语义层，非强制实现名） |
|---|------|-----|--------------------------------|
| 1 | created | collecting | 任务创建后进入采集 |
| 2 | created | cancelled / failed | 创建失败或取消 |
| 3 | collecting | collected | 首轮采集成功或 partial 降级结束 |
| 4 | collecting | failed / aborted / cancelled | 采集阶段终止 |
| 5 | collected | awaiting_manager_selection | Step4 Slack 发题成功 |
| 6 | collected | failed / aborted / cancelled | 首轮后终止 |
| 7 | analyzing | collected | 遗留 analyzing：Tidy 成功后迁回 collected |
| 8 | analyzing | analyzed | 遗留路径：旧 analyze 成功 |
| 9 | analyzing | failed / aborted / cancelled | 分析阶段终止 |
| 10 | analyzed | awaiting_manager_selection | 管理者选题（Slack 等）；或遗留产物就绪 |
| 11 | analyzed | analyzing / collected | 遗留重跑或整理迁移 |
| 12 | analyzed | failed / aborted / cancelled | 终止 |
| 13 | awaiting_manager_selection | manager_selected | Step4：`submit-pick` 选题落盘（`selected_topics` + `selected_collect_items`） |
| 14 | awaiting_manager_selection | approval_timeout | 超时未选 |
| 15 | awaiting_manager_selection | failed / aborted / cancelled | 等待阶段终止 |
| 16 | manager_selected | deep_collecting | 二次采集 / 深挖开始 |
| 17 | manager_selected | failed / aborted / cancelled | 终止 |
| 18–24 | deep_collecting → … → publishing | （见 §1） | Step5～7：二次采集、生成、发布链 |
| 25 | publishing | published / publish_partial_failed / failed / aborted / cancelled | 发布结束态 |

---

## 3. `steps.*` 与主状态对照（约定级）

主状态表示「大阶段」；细粒度在 `steps.<step>.status`。以下为 **推荐枚举**（与 `schema_task.md` 一致）：`pending | running | success | failed | partial_failed | init_failed`。

| 业务阶段（概念） | 典型 `task.status` | 典型 `steps`（示例） |
|------------------|---------------------|----------------------|
| Step1 建任务 | `created` → `collecting` | `collect`: pending→running |
| Step2 首轮采集 | `collecting` → `collected` | `collect`: running→success / partial_failed |
| Step3 话题整理（Tidy） | `collected` | `tidy`: pending→running→success；产物 `topic_candidates.v1` |
| Step4a Slack 发候选 | `collected` → `awaiting_manager_selection` | `approval`: pending→running；Slack `message_ts` 等 |
| Step4b 选题固化 | `awaiting_manager_selection` → `manager_selected` | `approval`→success；`approve`→success；`approve/selected_topics*.json`（当前多由 CLI `submit-pick` 触发） |
| Step5 二次采集（深挖） | `manager_selected` → `deep_collecting` → `deep_collected` | `deep_collect`（编排 **待接入**） |
| Step6 文案 + 图片 | `deep_collected` → … → `image_generated` | `generate` 下 copy / image 子步骤（**待接入**） |
| Step7 发布 | `image_generated` → `publishing` → `published` 等 | `publish`（**待接入**；另有独立 `publish` CLI） |

---

## 4. 与 Step4 触发条件（代码对齐）

- **默认**：`task.status=collected` 且 `steps.tidy.status=success` 且 `steps.approval` 待发送 → `EXECUTE_STEP4_SLACK_NOTIFY`。
- **遗留**：`task.status=analyzed` 且仅 `steps.analyze` 成功（无 Tidy）时仍可触发 Step4；读档优先 `steps.tidy.output_ref`，否则回退 `steps.analyze.output_ref`。

---

## 5. 变更检查清单（改迁移或加步骤时）

- [ ] `transitionGuard.ts` 中每条新业务边均有对应 `from → to`  
- [ ] `decideNextAction` 在对应 `task.status` + `steps.*` 下返回明确 `NextAction`  
- [ ] `dispatcher` 消费动作并仅通过 `updateTask()` 写回  
- [ ] `schema_task.md` / `schema_artifacts.md` 补充新产物与 `steps` 名  
- [ ] 本文档 §1–§2 与代码再次 diff 一遍  

---

## 6. 文档维护

- 每次修改 `node/src/orchestrator/transitionGuard.ts` 后 **必须更新** 本文 §1、§2。  
- 业务流程（Step 编号与语义）以 **`pipeline_steps_overview.md`**、`spec/steps/*.md` 与业务评审为准；本表负责 **状态机与代码对齐**。
