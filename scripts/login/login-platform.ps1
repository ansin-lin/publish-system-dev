# Manual platform login: opens Chrome, waits for login, saves storageState to data/auth.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("x", "facebook", "instagram", "xiaohongshu", "tiktok", "youtube")]
  [string]$Platform,

  [string]$Profile = "default",
  [int]$TimeoutMs = 1800000
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsDir = Split-Path -Parent $ScriptDir
$PublishRoot = Split-Path -Parent $ScriptsDir
$NodeDir = Join-Path $PublishRoot "node"

$importScript = Join-Path $ScriptsDir "Import-OpenClawGatewayEnv.ps1"
if (Test-Path $importScript) { . $importScript }

Set-Location $NodeDir
if (-not $env:PUBLISH_ORCH_CLI_CWD) { $env:PUBLISH_ORCH_CLI_CWD = $NodeDir }

Write-Host ""
Write-Host "=== Platform login: $Platform (profile=$Profile) ==="
Write-Host "Complete login in the Chrome window that opens."
Write-Host "On success or timeout, state is saved to:"
Write-Host "  data\auth\$Platform\$Profile\state.json"
Write-Host "Timeout: $([math]::Round($TimeoutMs / 60000, 1)) minutes"
Write-Host ""

npm run login -- --platform $Platform --profile $Profile --headless false --timeout_ms $TimeoutMs
$exitCode = $LASTEXITCODE

$statePath = Join-Path $PublishRoot "data\auth\$Platform\$Profile\state.json"
Write-Host ""
if (Test-Path $statePath) {
  $mtime = (Get-Item $statePath).LastWriteTime.ToString("o")
  Write-Host "OK state.json updated: $statePath"
  Write-Host "    last write: $mtime"
} else {
  Write-Host "WARN state.json not found — login may have failed or timed out before save."
}

if ($exitCode -ne 0) {
  Write-Host "FAIL npm run login exit=$exitCode"
}

Write-Host ""
Read-Host "Press Enter to close"
exit $exitCode
