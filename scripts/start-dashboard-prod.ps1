# Production dashboard: build frontend + serve API + static on one port (LAN-ready).
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-dashboard-prod.ps1
# Colleagues: http://<this-pc-lan-ip>:8787

param(
  [int]$Port = 8787,
  [string]$ListenHost = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishRoot = Split-Path -Parent $ScriptDir
$FrontendDir = Join-Path $PublishRoot "frontend"
$BackendDir = Join-Path $PublishRoot "backend"
$LogsDir = Join-Path $PublishRoot "logs"

if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null }

function Log([string]$msg) {
  $line = "$(Get-Date -Format 'o') $msg"
  Write-Host $line
}

Log "START dashboard-prod (host=$ListenHost port=$Port)"

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
  Log "npm install (frontend)..."
  Push-Location $FrontendDir
  npm install
  Pop-Location
}

Log "npm run build (frontend)..."
Push-Location $FrontendDir
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed exit=$LASTEXITCODE" }
Pop-Location

if (-not (Test-Path (Join-Path $BackendDir "node_modules"))) {
  Log "npm install (backend)..."
  Push-Location $BackendDir
  npm install
  Pop-Location
}

$env:DASHBOARD_PORT = "$Port"
$env:DASHBOARD_HOST = $ListenHost
$env:DASHBOARD_SERVE_STATIC = "1"
if (-not $env:OPENCLAW_ROOT) {
  $env:OPENCLAW_ROOT = Split-Path -Parent $PublishRoot
}

Log "backend start (OPENCLAW_ROOT=$($env:OPENCLAW_ROOT))"
Push-Location $BackendDir
npm run start:prod
