# Every 5 min: reconcile + dispatch-once (Step1–4a, Step4c compensate, Step6 when ready).
# OpenClaw Cron: publish-dispatch-run-once (see ~/.openclaw/cron/jobs.json)
param(
  [int]$Limit = 10
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$PublishRoot = Split-Path -Parent $ScriptDir
$NodeDir = Join-Path $PublishRoot "node"
$LogsDir = Join-Path $PublishRoot "logs"

if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null }

$logFile = Join-Path $LogsDir "cron-dispatch-$(Get-Date -Format 'yyyyMMdd').log"

function Log([string]$msg) {
  $line = "$(Get-Date -Format 'o') $msg"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

Log "START dispatch-run-once"
Set-Location $NodeDir

$importScript = Join-Path $ScriptDir "Import-OpenClawGatewayEnv.ps1"
if (Test-Path $importScript) { . $importScript }

if (-not $env:PUBLISH_ORCH_CLI_CWD) { $env:PUBLISH_ORCH_CLI_CWD = $NodeDir }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
npm run orchestrator -- run-once --limit $Limit 2>&1 | ForEach-Object { Log "$_" }
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($exitCode -ne 0) {
  Log "FAIL run-once exit=$exitCode"
  exit $exitCode
}

Log "OK run-once finished"
exit 0
