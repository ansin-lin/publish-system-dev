# Load OPENCLAW_SESSIONS_API_* from openclaw.json (for Step4 role / Step6 gateway roles).
param([switch]$Force)

$ErrorActionPreference = "Stop"

function Find-OpenClawConfig {
  $candidates = @()
  if ($env:OPENCLAW_CONFIG) { $candidates += $env:OPENCLAW_CONFIG }
  if ($env:OPENCLAW_HOME) { $candidates += (Join-Path $env:OPENCLAW_HOME "openclaw.json") }
  if ($PSScriptRoot) {
    $candidates += (Join-Path $PSScriptRoot "..\..\openclaw.json")
  }
  $candidates += (Join-Path $env:USERPROFILE ".openclaw\openclaw.json")
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return (Resolve-Path $p).Path }
  }
  return $null
}

$configPath = Find-OpenClawConfig
if (-not $configPath) {
  Write-Warning "Import-OpenClawGatewayEnv: openclaw.json not found"
  return
}

$raw = Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json
$port = $raw.gateway.port
if (-not $port) { $port = 18789 }
$token = $raw.gateway.auth.token

$baseUrl = "http://127.0.0.1:$port"
if ($Force -or -not $env:OPENCLAW_SESSIONS_API_BASE_URL) {
  $env:OPENCLAW_SESSIONS_API_BASE_URL = $baseUrl
}
if ($Force -or -not $env:OPENCLAW_SESSIONS_API_TOKEN) {
  if ($token) { $env:OPENCLAW_SESSIONS_API_TOKEN = $token }
}

if (-not $env:GOOGLE_API_KEY -and -not $env:GEMINI_API_KEY) {
  Write-Warning "Import-OpenClawGatewayEnv: GOOGLE_API_KEY / GEMINI_API_KEY not set — content-image image_generate will fail"
}
