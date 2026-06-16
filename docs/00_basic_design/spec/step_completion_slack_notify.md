# Step 完成 Slack 单向通知

> **实现**：`node/src/orchestrator/stepCompletionSlack.ts`、`node/src/orchestrator/stepNotifyDetail.ts`  
> **与 Step4 交互发帖分离**：Step4 候选列表仍见 `slack_protocol.md`；本文仅描述 **各 Step 完成后的状态播报**（无需回复）。

## 1. 投递方式

| 项 | 说明 |
|----|------|
| API | Slack `chat.postMessage`（**direct**，不经 OpenClaw agent） |
| 频道 / Token | 与 Step4 共用：`SLACK_BOT_TOKEN`、`PUBLISH_ORCH_SLACK_CHANNEL_ID` 或 `config/orchestrator_slack.json` |
| 时间格式 | JST，`yyyy-mm-dd HH:mm:ss`（如 `2026-05-27 16:00:00`） |
| 关闭 | `PUBLISH_ORCH_STEP_NOTIFY=0` |
| 仅打印 | `PUBLISH_ORCH_STEP_NOTIFY_DRY_RUN=1`（或与 `PUBLISH_ORCH_STEP4_DRY_RUN=1` 同开时打印正文） |

## 2. 触发时机与正文要点

| Step | 触发点（代码） | 正文补充 |
|------|----------------|----------|
| 1 | `step1-create/createTask.ts` | 任务已创建，进入采集 |
| 2 | `dispatcher`：`collected` 推进后 | 采集条数（含降级提示） |
| 3 | `dispatcher`：Tidy 成功 | 候选话题条数 |
| 4 | `step4-approval/applyPick.ts` | 已选话题个数 |
| 5 | `step5-research/generateResearch.ts` | 调研条目数 |
| 6 | `step6-generate/generateImages.ts` | **文案总字数**、**图片张数**、**图片来源：今日 \| 通用 \| AI生成** |
| 7 | `step7-publish/executor.ts` | **各平台一行**：成功 / 失败（登录态失效）/ 失败（未知问题）/ 跳过 |

### 2.1 消息模板（通用头）

```text
✅ Step{N} {阶段名}完成 — {时间}
task_id: `{task_id}` | run_id: `{run_id}`
{detail 多行或单行}
```

### 2.2 Step6 示例

```text
✅ Step6 文案和图片生成完成 — 2026-05-27 16:00:00
task_id: `daily-20260527-r01` | run_id: `r01`
文案 2840 字 | 图片 4 张 | 图片来源：通用
```

- **文案字数**：`copy_result` 中首个 topic 下各平台 `draft` 的 `title + body` 字符数之和。  
- **图片来源**：与 `image_result.image_source` 一致（`stock_today`→今日，`stock_common`→通用，否则 AI生成）。

### 2.3 Step7 示例

Slack 仅播报 **简短摘要**；`post_url`、完整 `error`/`reason` 仍写入 `publish/publish_result_*.json` 与 `task.json` 的 `steps.publish.platform_results`。

```text
✅ Step7 发布完成 — 2026-05-27 16:30:00
task_id: `daily-20260527-r01` | run_id: `r01`
*各平台结果：*
• Facebook：成功（已校验）
• X：失败（登录态失效）
• Instagram：失败（未知问题）

失败平台可在本线程回复：`retry facebook` 或 `retry 小红书`
```

| `PublishResult.status` | Slack 表述 |
|------------------------|------------|
| `published`（已校验） | 成功（已校验） |
| `published`（未校验） | 失败（校验未通过） |
| `validated` | 校验通过（未正式发布，如小红书 dry-run） |
| `auth_expired` | **失败（登录态失效）** |
| `failed`、`manual_required` | **失败（未知问题）** |
| `skipped` | 跳过 |

浏览器未启动等 **整批失败**：对各计划平台一行「失败（未知问题）」（不含错误原文）。

## 3. 失败策略

- 通知发送失败 **不阻断** 流水线（`console.warn`）。  
- 未配置 Token/频道时 **静默跳过**。

## 4. 相关环境变量

见 `docs/manual_commands.md` §9（`PUBLISH_ORCH_STEP_NOTIFY*`、`SLACK_BOT_TOKEN` 等）。
