# 流水线步骤总览（Step1～Step7）

本文档为 **产品语义** 下的步骤编号，与 `task.status` / `steps.*` 的对应关系见下表；实现细节见 `steps/step*.md` 与 `orchestrator_flow_step1_step7.md`。

| 步骤 | 名称 | 主要产物 / 行为 | 与 `task.json` 关系（概要） |
|------|------|-----------------|---------------------------|
| **Step1** | 任务创建 | `task.json`、任务目录、`outbox` 首事件 | `status`：created → collecting |
| **Step2** | 话题采集 | `collect/collect_result*.json` | `steps.collect`；结束后 `collected` |
| **Step3** | 话题整理（原分析步已废弃） | `tidy/topic_candidates*.json`（`topic_candidates.v1`） | `steps.tidy`；仍为 `collected` |
| **Step4** | Slack 管理者选择 + 固化选题文件 | 频道发帖、`steps.approval`；**`approve/selected_topics*.json`**、**`approve/selected_collect_items*.json`**（`selected_collect_items.v1`，首轮 collect 行切片） | `awaiting_manager_selection` → 选题后 `manager_selected` |
| **Step5** | 按选题二次采集 | `deep_collect/deep_collect_result*.json`（规划） | `deep_collecting` → `deep_collected`（编排侧 **待接入**） |
| **Step6** | 文案生成 + 图片生成 | `generate/copy_result*.json`、`generate/image_result*.json` | `generating_copy` / `generating_image` 等（**待接入**） |
| **Step7** | 文案发布 | `publish/publish_result*.json` | `publishing` → `published` / `publish_partial_failed`（**待接入**） |

**说明**

- **Step4 在代码中分两截**：① `dispatcher` 执行 `executeStep4SlackNotify`（发帖）；② 管理者确认后由 **`submit-pick` → `applyManagerPick`** 写入 **`selected_topics`**、**`selected_collect_items`**，并写回 **`steps.approve.collect_items_ref`**（若任务已是 `manager_selected` 仅补切片，可用 CLI **`materialize-collect`**）。产品上都归入 **Step4**。
- **Step5～Step7**：状态机在 `transitionGuard.ts` 中已有边，`dispatcher` 尚未串联对应 executor；发布能力另有 `node/src/publish` CLI 路径。
