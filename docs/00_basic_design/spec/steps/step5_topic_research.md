# Step 5 详细设计：内容素材（topic_research）

> **产品定位**：在 Step4 **`selected_topics.v1`** 基础上，按每条选题 **`title`** 调用 **`content-research`**，产出 **`topic_research.v1`**（内嵌 `research` 创作简报），供 **Step6** 使用。  
> **总览**：`../pipeline_steps_overview.md` · **素材字段**：`../../01_detailed_design/memo.md` · **角色**：`../../01_detailed_design/content_research_role.md` · **Schema**：`../schema_artifacts.md` §3.4

## 1. 输入/输出

- **输入**：`approve/selected_topics_*.json`（`steps.approve.selected_topics_ref`）
  - 每条：`title`（必填）、`topic_id`、`source_platform`、`source_url`
  - 可选 hint：`selected_collect_items` 同题行的 title/snippet（**非**完成条件）
- **输出**：`approve/topic_research_<JSTYYYYMMDD>_<runId>.json`（`topic_research.v1`）
- **Step5 完成**：`task.status` → **`research_done`**

## 2. `research` 对象（单条选题）

与 `memo.md` 一致；六字段均为 **非空字符串数组**（创作方向，非核实 URL）：

`keywords` · `articles` · `images` · `videos` · `core_points` · `writing_angles`

| 字段 | Step6 用途 |
|------|------------|
| `core_points` / `writing_angles` / `articles` | **content-copy** 写稿 |
| `images` | 与 copy 的 `image_prompts` **合并** 后给 **content-image** |

## 3. 前置条件

- `task.status` = **`topics_selected`**（Step4 已完成）
- `steps.approve.status` = `success`，且 `selected_topics_ref` 存在
- OpenClaw Gateway 可用（`content-research` 角色）
- 若已有 `topic_research` 且 `steps.research.status=success` → 幂等跳过

## 4. 处理流程

1. `run-once` → `EXECUTE_STEP5_GENERATE_RESEARCH`（或等价 executor）。
2. `task.status` → `generating_research`（进行中，可选显式状态）。
3. 对 `selected_topics.items[]` 逐条调 `content-research`。
4. 落盘 `topic_research.v1`；`updateTask()`：
   - `steps.research`：`success`，`output_ref` → topic_research 路径
   - `steps.approve.research_ref`（与 `output_ref` 可同路径）
   - `task.status` → **`research_done`**

## 5. 状态推进

| 阶段 | `task.status` | `steps.research` | `steps.approve` |
|------|----------------|------------------|-----------------|
| 待执行 | `topics_selected` | `pending` | `success`（含 selected_topics_ref） |
| 执行中 | `generating_research` | `running` | `success` |
| **Step5 完成** | **`research_done`** | `success`，`output_ref`→topic_research | `research_ref` 已填 |

## 6. 失败与重试

- Gateway 不可用、角色超时、JSON 不合规 → 可重试；`steps.research.status=failed`
- **不**应回到 `awaiting_manager_selection`；选题文件保留，仅重跑 Step5

## 7. 幂等

- `task_id + run_id + selected_topics 内容 hash + research_role_version`

## 8. 与「Step5+ 素材增强」的区别

| | **Step5（本文）** | **Step5+（可选）** |
|--|-------------------|---------------------|
| 产物 | `topic_research.v1` / `research` 简报 | `enriched_research`（真实 URL 等） |
| 编排 | **主路径，已由 dispatcher 接入** | 未接（`enriched_research` 为可选规划） |
| Step6 输入 | **默认只读 topic_research** | 有 enriched 时优先 enriched |

## 9. 实现对照（2026-06）

- 代码入口：`node/src/step5-research/generateResearch.ts`；dispatcher `EXECUTE_STEP5_GENERATE_RESEARCH`
- Step5 完成态：**`research_done`**（`manager_selected` 仅 `transitionGuard` 遗留兼容）
- Step5 成功后 dispatcher 可链式触发 Step6（copy + image）
