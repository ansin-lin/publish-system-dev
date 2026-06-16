# publish-system/scripts

定时脚本（被 OpenClaw Cron 调用，也可手动或 Windows 任务计划程序跑 `.bat`）。

| 文件 | 作用 |
|------|------|
| `daily-create-task.ps1` / `.bat` | 每天 **09:00** 建任务 `daily-YYYYMMDD-r01`（已存在则 SKIP） |
| `daily-create-task-1300.bat` | **13:00** 建任务 `daily-YYYYMMDD-r02` |
| `daily-create-task-1700.bat` | **17:00** 建任务 `daily-YYYYMMDD-r03` |
| `dispatch-run-once.ps1` / `.bat` | 每 5 分钟 `run-once` 推进流水线；若 `step1.ensure_daily.enabled`，按 JST 时段补建当日任务（默认 **09:00–12:00 r01**、**13:00–16:00 r02**、**17:00–19:00 r03**，已存在则跳过） |
| `start-dashboard-prod.ps1` | 生产仪表盘：构建 frontend + 启动 backend（局域网 `:8787`）。见 [lan-production-deploy.md](../docs/02_dashboard/lan-production-deploy.md) |
| `Import-OpenClawGatewayEnv.ps1` | 从 `openclaw.json` 注入 Gateway 环境变量 |

## OpenClaw Cron（已注册）

见 `C:\Users\compu\.openclaw\cron\jobs.json`：

- **publish-daily-create-task**：`0 9 * * *`（Asia/Tokyo）→ 每天 **9:00** 建任务（不是 0 点；若要 0 点改 cron 为 `0 0 * * *`）
- **publish-dispatch-run-once**：每 **300000 ms**（5 分钟）→ `dispatch-run-once.ps1`

需 **Gateway 常驻**：`openclaw gateway` 或 `gateway.cmd`。

## 手动测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\compu\.openclaw\publish-system\scripts\daily-create-task.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\compu\.openclaw\publish-system\scripts\dispatch-run-once.ps1"
```

日志：`publish-system\logs\cron-create-*.log`、`cron-dispatch-YYYYMMDD.log`。
