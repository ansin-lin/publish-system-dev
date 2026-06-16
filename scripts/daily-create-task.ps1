# Daily Step1: create-task (idempotent per calendar day).
# OpenClaw Cron: publish-daily-create-task (see ~/.openclaw/cron/jobs.json)
param(
  [string]$RunId = "r01",
  [string]$Trigger = "daily_cron"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishRoot = Split-Path -Parent $ScriptDir
$NodeDir = Join-Path $PublishRoot "node"
$LogsDir = Join-Path $PublishRoot "logs"
$TasksDir = Join-Path $PublishRoot "data\tasks"

if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null }

$taskId = "daily-$(Get-Date -Format 'yyyyMMdd')-$RunId"
$logFile = Join-Path $LogsDir "cron-create-$taskId.log"

function Log([string]$msg) {
  $line = "$(Get-Date -Format 'o') $msg"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

$taskJson = Join-Path (Join-Path $TasksDir $taskId) "task.json"
if (Test-Path $taskJson) {
  Log "SKIP task already exists: $taskId"
  exit 0
}

Log "START daily-create-task task_id=$taskId"
Set-Location $NodeDir

$importScript = Join-Path $ScriptDir "Import-OpenClawGatewayEnv.ps1"
if (Test-Path $importScript) { . $importScript }

npm run orchestrator -- create-task --task-id $taskId --run-id $RunId --trigger $Trigger 2>&1 | ForEach-Object { Log "$_" }
if ($LASTEXITCODE -ne 0) {
  Log "FAIL create-task exit=$LASTEXITCODE"
  exit $LASTEXITCODE
}

if (-not (Test-Path $taskJson)) {
  Log "FAIL task.json missing after create: $taskId"
  exit 1
}

Log "OK created $taskId"
exit 0
