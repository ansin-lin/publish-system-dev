## publish-system（多平台内容发布系统）

**当前仓库目录与文件说明（与代码对齐）**：见 **`docs/PROJECT_LAYOUT.md`**。

本仓库是一个“落盘驱动”的多平台发布系统骨架：

- **`data/`**：任务、登录态、素材、临时文件（统一目录约定，便于 OpenClaw 与发布器解耦）
- **`logs/`**：系统/任务/发布日志（可审计、可回溯）
- **`node/`**：Node.js + Playwright：编排器、Step2 采集、Tidy、Slack、发布（TypeScript）
- OpenClaw 角色工作区在仓库根 `workspace-*`（见 `~/.openclaw/openclaw.json`），不在 `publish-system/` 内

### 核心约定（你最需要“固定下来”的部分）

- **任务即文件**：一个任务对应一个 JSON 文件；任务状态通过“文件所在目录”表达
- **单向流转**：`approved -> active -> (published|failed) -> archive`
- **发布器不依赖数据库**：只依赖文件系统与固定路径配置，适合本机/服务器/CI
- **可审计**：每次发布落盘 artifacts（日志/截图/结果 JSON），可按 `task_id/publish_id` 追踪

### 目录结构（系统级）

```text
data/
  tasks/{approved,active,published,failed,archive}/
  auth/<platform>/                # Playwright storageState（以及可能的 cookie/session）
  assets/{img,video}/
  temp/
logs/
  task/                           # 一任务一目录（建议）
  publish/                        # 一次发布一次日志（可选）
  jobs/                           # 平台级滚动日志（可选）
  system.log
config/
  publish.orchestrator.json       # 编排器主配置（必填）
  collect_*.json / tophub_*.json  # Step2 子配置（由主配置引用）
  business.json                   # 文案规范/公司要求
  filters.json                    # 过滤与风控规则
docs/
  00_basic_design/              # 主规范（spec/steps、schema、状态机）
  01_detailed_design/           # 运维清单与 Step5/6 细则
  参考命令/manual_commands.md
  移行手顺/新电脑完整配置手顺.md
```

### 任务文件（统一 JSON）与 Node 发布器的关系

Node 发布器（`node/`）已经实现了以下关键行为：

- **默认任务来源**：从 `data/tasks/approved/` 选择“下一条”任务（按 mtime 升序，其次按文件名）
- **执行模式**：`--mode post`（图文）与 `--mode video`（仅视频）分离
- **平台 payload 合并**：`payloads.<platform>` > `payloads.default` > 顶层旧字段（兼容）
- **输出结果**：stdout 打印结果 JSON（方便 OpenClaw 直接采集），并落盘 artifacts

任务与产物规范见 `docs/00_basic_design/spec/schema_task.md`、`schema_artifacts.md`；流程见 `spec/orchestrator_flow_step1_step7.md`。

### 快速开始（本机）

- **准备登录态**：先运行 `node/` 的登录流程生成 `data/auth/<platform>/...` 下的状态文件
- **放入待发布任务**：把任务 JSON 放进 `data/tasks/approved/`
- **执行发布**：运行 `node/` 的 publish 命令（它会自动取下一条）

> 具体命令与参数以 `node/README.md` 为准（该目录是可独立运行的发布器项目）。

