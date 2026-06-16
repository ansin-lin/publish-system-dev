# Dashboard 本机生产部署（局域网访问）

> **适用场景**：在一台 Windows 电脑上作为服务器，向社内局域网提供只读仪表盘 Web 页面。  
> **实现**：`frontend/dist` 静态托管 + `backend` REST API，**单端口 8787**。  
> **脚本**：[`scripts/start-dashboard-prod.ps1`](../../scripts/start-dashboard-prod.ps1)

---

## 1. 架构

```text
同事浏览器  →  http://192.168.x.x:8787
                      ↓
              backend (Hono, @hono/node-server)
                 ├─ /api/*     读 task.json、outbox、cron、日志等
                 └─ /*         frontend/dist（React 构建产物）
```

| 组件 | 路径 | 生产职责 |
|------|------|----------|
| 前端 | `frontend/` | `npm run build` → `frontend/dist` |
| 后端 | `backend/` | API + 静态文件托管 |
| 编排数据 | `data/tasks/`、`data/system/orchestrator.db` | 只读展示（推进仍靠 `node/` cron） |

**与开发模式的区别**

| 项 | 开发 (`npm run dev`) | 生产（本文） |
|----|----------------------|--------------|
| 前端 | Vite `:5173` | 构建进 `dist`，由 backend 托管 |
| 后端 | `:8787`，通常仅本机 | `:8787`，`DASHBOARD_HOST=0.0.0.0` 局域网可访问 |
| 同事访问 | `http://IP:5173`（需 `--host 0.0.0.0`） | **`http://IP:8787`**（推荐） |

---

## 2. 前置条件

| 项 | 要求 |
|----|------|
| Node.js | **20 LTS+**（建议 22，与 `node/` 编排器一致） |
| 仓库 | `publish-system` 已 clone 到本机（示例：`C:\Users\compu\.openclaw\publish-system`） |
| OpenClaw 根 | `OPENCLAW_ROOT` 指向 `~/.openclaw`（含 `cron/jobs.json`） |
| 配置 | `config/publish.orchestrator.json` 存在且可读 |
| 网络 | 服务器与同事 PC 在同一局域网（同一网段） |

---

## 3. 首次安装

PowerShell：

```powershell
cd C:\Users\compu\.openclaw\publish-system\frontend
npm install

cd ..\backend
npm install
```

---

## 4. 构建与启动

### 4.1 一键脚本（推荐）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\compu\.openclaw\publish-system\scripts\start-dashboard-prod.ps1
```

可选参数：

```powershell
# 自定义端口 / 监听地址
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-dashboard-prod.ps1 -Port 8787 -ListenHost 0.0.0.0
```

脚本步骤：

1. `frontend` → `npm run build` → 生成 `frontend/dist`
2. 设置环境变量（见 §5）
3. `backend` → `npm run start:prod`

启动成功日志示例：

```text
[dashboard] serving frontend: ...\frontend\dist
[dashboard] listening on http://0.0.0.0:8787
```

### 4.2 手动分步

```powershell
# 1. 构建前端
cd C:\Users\compu\.openclaw\publish-system\frontend
npm run build

# 2. 启动后端
cd ..\backend
$env:DASHBOARD_PORT = "8787"
$env:DASHBOARD_HOST = "0.0.0.0"
$env:DASHBOARD_SERVE_STATIC = "1"
$env:OPENCLAW_ROOT = "C:\Users\compu\.openclaw"
npm run start:prod
```

---

## 5. 环境变量

| 变量 | 生产推荐值 | 说明 |
|------|------------|------|
| `DASHBOARD_HOST` | `0.0.0.0` | 允许局域网访问；默认 `127.0.0.1` 仅本机 |
| `DASHBOARD_PORT` | `8787` | HTTP 监听端口 |
| `DASHBOARD_SERVE_STATIC` | `true` / `1` | 托管 `frontend/dist` |
| `OPENCLAW_ROOT` | `C:\Users\compu\.openclaw` | cron、dispatch 日志等路径解析 |
| `PUBLISH_ORCHESTRATOR_CONFIG` | （可选） | 非默认 config 路径时指定 |

示例文件：[`backend/.env.example`](../../backend/.env.example)  
（Node 不会自动读 `.env`；请在 PowerShell、计划任务或启动脚本中 export。）

**CORS**：生产单端口同源访问 `/api`，一般无需设置 `DASHBOARD_CORS_ORIGINS`。若前后端分端口部署，见 `dashboardConfig.ts`。

---

## 6. 局域网访问地址

### 6.1 查本机 IP

```powershell
ipconfig
```

记下 **IPv4 地址**（例：`192.168.1.100`）。

### 6.2 发给同事

```text
http://192.168.1.100:8787
```

### 6.3 自检

| URL | 期望 |
|-----|------|
| `http://127.0.0.1:8787` | 首页正常 |
| `http://192.168.1.100:8787` | 首页正常 |
| `http://192.168.1.100:8787/api/health` | JSON，`ok: true` |

---

## 7. Windows 防火墙

以**管理员** PowerShell 放行 TCP **8787**：

```powershell
New-NetFirewallRule -DisplayName "Publish Dashboard 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

或在「Windows 安全中心 → 防火墙 → 高级设置 → 入站规则」中新建端口规则。

---

## 8. 更新部署

前端或后端代码变更后：

```powershell
cd C:\Users\compu\.openclaw\publish-system\frontend
npm run build
```

然后**重启 backend 进程**（Ctrl+C 后重新执行 §4）。  
运行中的 Node 不会自动加载新的 `dist`。

仅 backend 代码变更时：

```powershell
cd C:\Users\compu\.openclaw\publish-system\backend
npm run start:prod
# 环境变量同 §4.2
```

---

## 9. 开机自启（可选）

**任务计划程序** → 创建基本任务：

| 项 | 值 |
|----|-----|
| 触发器 | 用户登录时 / 系统启动时 |
| 程序 | `powershell.exe` |
| 参数 | `-NoProfile -ExecutionPolicy Bypass -File C:\Users\compu\.openclaw\publish-system\scripts\start-dashboard-prod.ps1` |
| 起始于 | `C:\Users\compu\.openclaw\publish-system` |

建议为本机在路由器上配置 **固定局域网 IP**，避免 IP 变动后同事无法访问。

---

## 10. 与编排器的关系

| 服务 | 作用 | 同事看页面时 | 任务自动推进时 |
|------|------|--------------|----------------|
| Dashboard `:8787` | 只读 Web 展示 | **需要** | 可选 |
| `dispatch-run-once` cron | 推进 r01/r02/r03 | 不需要 | **需要** |
| `node/` orchestrator | Step1～7 执行 | 不需要 | **需要** |

仪表盘**不写** `task.json`、**不**跑 dispatcher；仅展示本机已有任务数据。

---

## 11. 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 本机能开，同事不能 | 防火墙 / 不同网段 / 访客 Wi‑Fi 隔离 | §7；确认 ping 通 |
| 页面空白 | 未 build 或未托管静态 | 确认日志有 `serving frontend`；检查 `frontend/dist/index.html` |
| `/api/*` 404 | 直接打开了错误端口 | 统一用 `:8787` |
| 无任务列表 | `data/tasks/` 无数据或不可读 | 看 `/api/health` 的 `tasks_dir_readable` |
| 端口占用 | 8787 已被占用 | `-Port 8788` 或改 `DASHBOARD_PORT`，同步防火墙 |
| 启动报 config 缺失 | `publish.orchestrator.json` 不存在 | 从 example 复制并编辑 |

---

## 12. 安全注意

- 当前仪表盘为 **只读**（P1），**无登录鉴权**。
- **仅限社内局域网**使用；勿做路由器端口转发暴露到公网。
- 服务器休眠/关机后页面不可用。
- 涉密环境请按公司 IT 规范评估是否允许局域网 HTTP 明文访问。

---

## 13. 相关文件

| 文件 | 说明 |
|------|------|
| [`scripts/start-dashboard-prod.ps1`](../../scripts/start-dashboard-prod.ps1) | 生产一键构建 + 启动 |
| [`backend/src/index.ts`](../../backend/src/index.ts) | HTTP 入口 |
| [`backend/src/config/dashboardConfig.ts`](../../backend/src/config/dashboardConfig.ts) | 端口 / 主机 / 静态托管配置 |
| [`frontend/vite.config.ts`](../../frontend/vite.config.ts) | 开发代理（生产不经过 Vite） |
| [`docs/02_dashboard/tech-stack.md`](./tech-stack.md) | 技术选型 |
