# Publish-System 手动命令大全

面向 **Step1～Step7 编排流水线** 的日常运维与调试。所有 `npm` 命令默认在 **`publish-system/node`** 目录执行。

```powershell
cd C:\Users\compu\.openclaw\publish-system\node
```

路径约定（本机示例）：

| 用途 | 路径 |
|------|------|
| 任务 SSOT | `publish-system\data\tasks\<task_id>\task.json` |
| 编排 SQLite | `publish-system\data\system\orchestrator.db` |
| 任务日志 | `publish-system\logs\task\<task_id>\` |
| Cron 日志 | `publish-system\logs\cron-*.log` |
| 平台登录态 | `publish-system\data\auth\<platform>\<profile>\state.json` |

---

## 0. 环境与安装（首次 / 换机）

```powershell
cd C:\Users\compu\.openclaw\publish-system\node
npm install
npm run install:browsers
# 等价：npx playwright install
```

类型检查：

```powershell
npm run typecheck
```

**OpenClaw Gateway**（**Step5/6** 内容角色；Step4 已不依赖 Gateway）需常驻，并保证编排 CLI 工作目录正确：

```powershell
# 可选：固定 orchestrator 子进程 cwd
$env:PUBLISH_ORCH_CLI_CWD = "C:\Users\compu\.openclaw\publish-system\node"
```

从 `openclaw.json` 注入 Gateway 相关环境（Cron 脚本也会调用）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\compu\.openclaw\publish-system\scripts\Import-OpenClawGatewayEnv.ps1"
```

---

## 1. 流水线总览与推进方式

| Step | 名称 | 典型结束状态 | 自动推进（`run-once`） | 常用手动命令 |
|------|------|--------------|------------------------|--------------|
| 1 | 创建任务 | `collecting` | ✅ | `create-task` |
| 2 | 采集 | `collected` | ✅ | `collect` 或 `run-once` |
| 3 | Tidy 候选整理 | `collected` | ✅ | `run-once` |
| 4a | Slack 发候选 | `awaiting_manager_selection` | ✅ | `run-once` |
| 4b | 管理者选题 | `topics_selected` | ✅（轮询 pick） | Slack 线程 `pick` + 下次 `run-once`；CLI 兜底 `submit-pick` |
| 5 | 选题调研 | `research_done` | ✅ | `run-once` |
| 6 | 文案 + 配图 | `image_generated` | ✅ | `generate-content` 或 `run-once` |
| 7 | 多平台发布 | `published` 等 | ✅ | `publish-task` 或 `run-once` |

**一键推进（推荐日常）**：先 `reconcile`（含超时 `running` 回退），再 `dispatch-once`。

```powershell
npm run orchestrator -- run-once
npm run orchestrator -- run-once --limit 20
```

仅消费 outbox、不做 reconcile：

```powershell
npm run orchestrator -- dispatch-once --limit 10
```

---

## 2. 编排器 CLI 全表

查看帮助：

```powershell
npm run orchestrator -- help
```

### 2.1 数据库与 outbox

```powershell
# 初始化 SQLite（新环境 / 删库后）
npm run orchestrator -- init-db

# 清空 outbox（任务目录已删、需重建事件队列时；必须带 --yes）
npm run orchestrator -- clear-outbox --yes
```

### 2.2 补偿与卡死恢复

```powershell
# 回收超时 processing 事件 + 为非终态任务补 TASK_RECONCILE
# + 扫描 steps.*.running 超过阈值（默认 1h）并回退上一阶段
npm run orchestrator -- reconcile

# 只预览 stale 回退，不写 task.json
npm run orchestrator -- reconcile --stale-dry-run
```

**Stale 回退规则（自动，`reconcile` / `run-once` 内）**：

| 卡住 | 回退到 |
|------|--------|
| `collecting` + `collect.running` | `collect` → failed，可重采 |
| `collected` + `tidy.running` | `collected`，`tidy` → failed |
| `generating_research` + `research.running` | `topics_selected` |
| `generating_copy` + `copy.running` | `research_done` |
| `generating_image` + `image.running` | `copy_generated` |
| `publishing` + `publish.running`（无发布结果） | `image_generated` |

**不自动回退**：`awaiting_manager_selection`（等人 Slack 选题）。

### 2.3 Step1：创建任务

```powershell
# 调试任务（随机 task_id）
npm run orchestrator -- create-task

# 指定 ID（与 Cron 一致：daily-YYYYMMDD-r01）
npm run orchestrator -- create-task --task-id daily-20260527-r01 --run-id r01 --trigger manual_debug
```

产物：`data\tasks\<task_id>\task.json`，状态 `collecting`。

### 2.4 Step2：采集（可单独跑）

```powershell
$taskId = "daily-20260527-r01"
$taskJson = "C:\Users\compu\.openclaw\publish-system\data\tasks\$taskId\task.json"

npm run collect -- --task-json $taskJson
```

可选覆盖采集配置：

```powershell
npm run collect -- --task-json $taskJson --aggregate-config ..\config\collect_aggregate.json
```

之后用 `run-once` 把 `collect` 结果推进到 `collected` 并继续 Step3。

### 2.5 Step3～4a、5～6：自动链（`run-once`）

```powershell
npm run orchestrator -- run-once --limit 10
```

单步等效关系：

- Step3：`collected` → 执行 Tidy → 仍 `collected`
- Step4a：Tidy 成功 → Slack 候选 → `awaiting_manager_selection`
- Step4b：`run-once` 轮询 Slack 线程 → `pick` 落盘 → `topics_selected`（延迟 ≤ 一个 cron 周期，默认约 5 分钟）
- Step5：`topics_selected` → `generating_research` → `research_done`
- Step6：`research_done` → 文案/配图 → `image_generated`
- Step7：`image_generated` → `publishing` → `published` / `publish_partial_failed` / `failed`

### 2.6 Step4b：管理者选题（Slack `pick` + `run-once` 轮询）

**正常流程**（无需 CLI）：

1. Step4a 发帖后，在 **同一线程** 回复，例如：`pick 21` 或 `pick 2,5,8`
2. 等待下一次 `run-once`（或 cron `dispatch-run-once.ps1`）→ `topics_selected`

`run-once` 输出含 `step4_poll.picks_applied`；日志：`publish-system/logs/step4-slack-YYYYMMDD.log`。

**CLI 兜底**（轮询失败或紧急重试）：

```powershell
$taskId = "daily-20260527-r01"
npm run orchestrator -- submit-pick --task-id $taskId --raw "pick 21" --operator "U0AU3C9CG7N"
```

- 默认 **只落盘 Step4**（`topics_selected` + `selected_topics`），**不**在 pick 里连跑 Step5/6。
- `--advance`：pick 后尝试连跑后续（一般不推荐）。

**Slack Bot 权限**：`chat:write`、`channels:history`（私密频道用 `groups:history`）。`SLACK_BOT_TOKEN` 与 OpenClaw Gateway 可共用同一 App Token。

**补写选中采集条目**（可选，Step5 提示用）：

```powershell
npm run orchestrator -- materialize-collect --task-id $taskId --indices "21"
# 或
npm run orchestrator -- materialize-collect --task-id $taskId --raw "pick 21"
```

### 2.7 Step5：仅调研（一般由 run-once 触发）

无单独 CLI；失败后可 `run-once` 重试。确保 Step4 已有 `steps.approve.success` 与 `selected_topics_ref`。

### 2.8 Step6：文案 + 配图

```powershell
npm run orchestrator -- generate-content --task-id daily-20260527-r01
# 别名
npm run orchestrator -- generate-images --task-id daily-20260527-r01
```

要求：`task.status` 为 `research_done`（或兼容的 `manager_selected`），且 `topic_research` 文件存在。

**配图来源（自动，单 topic）**：`data/assets/img/{yyyymmdd}/` → `Common/` → AI API。目录有图则**不调 API**，路径写入 `image_result`；Step7 直接读该文件。详见 [step6_stock_images.md](00_basic_design/spec/step6_stock_images.md)。

预置图目录示例：

```text
publish-system\data\assets\img\20260527\   # 当日（JST yyyymmdd）
publish-system\data\assets\img\Common\     # 通用兜底
```

### 2.9 Step7：发布

```powershell
# 全平台（copy_result 里配置的平台，通常 x / facebook / instagram / xiaohongshu）
npm run orchestrator -- publish-task --task-id daily-20260527-r01

# 指定平台
npm run orchestrator -- publish-task --task-id daily-20260527-r01 --platforms x,facebook

# 无头
npm run orchestrator -- publish-task --task-id daily-20260527-r01 --headless

# 只生成 publish_job.json，不打开浏览器
npm run orchestrator -- publish-task --task-id daily-20260527-r01 --dry-run
```

Step6/7 完成后会向 Slack 发**单向完成通知**（需 `SLACK_BOT_TOKEN` + 频道）。Step6 含文案字数、图片张数、图片来源（今日/通用/AI生成）；Step7 含各平台成功或失败原因。见 [step_completion_slack_notify.md](00_basic_design/spec/step_completion_slack_notify.md)。

**发布失败后重试**（任务已是终态 `failed` 时）：

```powershell
npm run orchestrator -- publish-task --task-id daily-20260527-r01 --platforms xiaohongshu
# 全量重置后再发（会清空 publish 产物）
npm run orchestrator -- retry-step7 --task-id daily-20260527-r01
npm run orchestrator -- publish-task --task-id daily-20260527-r01
# 或
npm run orchestrator -- run-once
```

`publish_partial_failed` 下可直接 `publish-task --platforms …` **只补失败平台**（合并上次 `platform_results`，已成功且 `verified` 的不会重发）。

在 **Step7 发布完成通知** 的线程内回复 `retry instagram` 或 `retry xiaohongshu`（`run-once` 轮询；旧任务无 Step7 帖时回退 Step4 选题帖）。配置：`slack.step7.retry_receive.thread_source=step7`。

`retry-step7` 将 `task.status` 置回 `image_generated`，`steps.publish` 置为 `pending`（清空上次 error / platform_results）。

**直接用 publish_job 发（绕过编排状态机）**：

```powershell
$job = "C:\Users\compu\.openclaw\publish-system\data\tasks\daily-20260527-r01\publish\publish_job_20260527_r01.json"
npm run publish -- --job $job --platforms x,facebook
```

---

## 3. 平台登录（发布前）

### 3.1 双击登录（推荐）

目录：`publish-system\scripts\login\`

| 文件 | 平台 |
|------|------|
| `login-x.bat` | X |
| `login-facebook.bat` | Facebook |
| `login-instagram.bat` | Instagram |
| `login-xiaohongshu.bat` | 小红书创作者后台 |
| `login-tiktok.bat` | TikTok |
| `login-youtube.bat` | YouTube Studio |

用法：双击对应 `.bat` → 在弹出的 Chrome 中手动登录 → 脚本检测到成功或超时后自动保存登录态 → 按 Enter 关闭窗口。

- 登录态：`data\auth\<platform>\default\state.json`
- Chrome 持久 profile：`data\temp\chrome-profiles\<platform>\default\`
- 默认等待 **30 分钟**（小红书验证码等场景）
- 需要本机已安装 **Google Chrome**；登录过程中勿与 Step7 发布同一平台并发

通用脚本（PowerShell）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\compu\.openclaw\publish-system\scripts\login\login-platform.ps1" -Platform xiaohongshu
```

### 3.2 命令行登录

```powershell
cd C:\Users\compu\.openclaw\publish-system\node
npm run login -- --platform x --profile default
npm run login -- --platform facebook --profile default
npm run login -- --platform instagram --profile default
npm run login -- --platform xiaohongshu --profile default
npm run login -- --platform tiktok --profile default
npm run login -- --platform youtube --profile default
```

登录态写入：`data\auth\<platform>\default\state.json`。

---

## 4. 单平台发布测试（不经过完整 task 流水线）

```powershell
npm run test:x-publish
npm run test:fb-publish
npm run test:xhs-publish
```

X 录制/调试 codegen 流：

```powershell
npm run capture:x-publish
```

---

## 5. Windows Cron / 定时脚本

| 脚本 | 作用 |
|------|------|
| `scripts\daily-create-task.ps1` | 每天创建 `daily-YYYYMMDD-r01`（已存在则 SKIP） |
| `scripts\dispatch-run-once.ps1` | 每 5 分钟 `run-once` |

手动执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\compu\.openclaw\publish-system\scripts\daily-create-task.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\compu\.openclaw\publish-system\scripts\dispatch-run-once.ps1"
```

---

## 6. 从零重跑一条任务（常用组合）

```powershell
cd C:\Users\compu\.openclaw\publish-system\node
$taskId = "daily-20260527-r01"

# 1) 若 Step7 失败在 failed
npm run orchestrator -- retry-step7 --task-id $taskId

# 2) 装浏览器（若报 chromium 不存在）
npm run install:browsers

# 3) 发布
npm run orchestrator -- publish-task --task-id $taskId

# 4) 查看结果
# task.json → steps.publish.platform_results
# data\tasks\<id>\publish\publish_result_*.json
```

**新建一天任务并自动跑**：

```powershell
powershell -File ..\scripts\daily-create-task.ps1
npm run orchestrator -- run-once
# 在 Slack pick 后：
npm run orchestrator -- submit-pick --task-id daily-20260527-r01 --raw "pick 2,5"
npm run orchestrator -- run-once
```

---

## 7. 清空数据重新开始

```powershell
# 删所有任务目录
Remove-Item "C:\Users\compu\.openclaw\publish-system\data\tasks\*" -Recurse -Force

# 删 orchestrator 库
Remove-Item "C:\Users\compu\.openclaw\publish-system\data\system\orchestrator.db*" -Force -ErrorAction SilentlyContinue

cd C:\Users\compu\.openclaw\publish-system\node
npm run orchestrator -- init-db
```

（保留 `data\auth` 登录态；删 `data\assets` / `logs` 按需自行处理。）

---

## 8. 查看状态与产物

| 看什么 | 位置 |
|--------|------|
| 主状态 | `data\tasks\<task_id>\task.json` → `status`、`steps.*` |
| 每平台发布结果 | `steps.publish.platform_results` 或 `publish\publish_result_*.json` |
| 发布任务定义 | `publish\publish_job_*.json` |
| 选题候选 | `tidy\topic_candidates_*.json` |
| 已选题目 | `approve\selected_topics_*.json` |
| 调研 | `approve\topic_research_*.json` |
| 文案/配图 | `generate\copy_result_*.json`、`generate\image_result_*.json` |
| Step7 平台日志 | `logs\task\<task_id>\` 下各平台 artifact |

---

## 9. 常用环境变量（可选）

| 变量 | 作用 |
|------|------|
| `PUBLISH_ORCH_CLI_CWD` | OpenClaw 调 orchestrator 时的 node 目录 |
| `PUBLISH_ORCH_STEP4_DELIVERY` | `node` / `dry_run`（`role`/`direct`/`auto` 已废弃，运行时映射为 `node`） |
| `PUBLISH_ORCH_SLACK_CHANNEL_ID` | Step4 Slack 频道（Step 完成通知共用） |
| `SLACK_BOT_TOKEN` | Step4 发帖/轮询/回复 + Step 完成通知（`chat.postMessage` / `conversations.replies`） |
| `PUBLISH_ORCH_STEP_NOTIFY` | 设为 `0` 关闭各 Step 完成单向通知（默认开启） |
| `PUBLISH_ORCH_STEP_NOTIFY_DRY_RUN` | `1` 时只打印通知正文、不发 Slack |
| `PUBLISH_ORCH_STEP7_PLATFORMS` | Step7 默认平台过滤 |
| `PUBLISH_ORCH_STEP7_DRY_RUN` | `1` 时 Step7 只写 job |
| `PUBLISH_ORCH_STEP7_HEADLESS` / `PUBLISH_HEADLESS` | 无头发布 |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Step6 配图（GenAI） |
| `PUBLISH_ORCH_FORCE_AI_IMAGES` | `1` 时 Step6 忽略库存图，强制走 API |

**Step6 库存配图**（单 topic）：`data/assets/img/{yyyymmdd}/` → `Common/` → API；路径见 `config/paths.json` 的 `assets_img_dir`。扩展名 `.png` `.jpg` `.jpeg`。设计说明：[step6_stock_images.md](00_basic_design/spec/step6_stock_images.md)。

**Step 完成 Slack 通知**：默认开启；Step6/7 字段见 [step_completion_slack_notify.md](00_basic_design/spec/step_completion_slack_notify.md)。

---

## 10. 相关设计文档

- [basic_design.md](00_basic_design/basic_design.md) — 架构与约束  
- [pipeline_steps_overview.md](00_basic_design/spec/pipeline_steps_overview.md) — 步骤语义  
- [state_transitions_table.md](00_basic_design/spec/state_transitions_table.md) — 状态迁移  
- [step1_to_step7_e2e_checklist.md](00_basic_design/debug/step1_to_step7_e2e_checklist.md) — E2E 调试清单  
- [step6_stock_images.md](00_basic_design/spec/step6_stock_images.md) — Step6 库存配图  
- [step_completion_slack_notify.md](00_basic_design/spec/step_completion_slack_notify.md) — Step 完成 Slack 通知  

---

*文档版本：与 `node/src/cli/orchestrator.ts` 同步；变更 CLI 时请更新本文。*
