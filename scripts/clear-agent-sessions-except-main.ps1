# Remove ephemeral pipeline/cron isolated sessions; keep main, Slack, DM, webchat, etc.
# Default: -DryRun (preview only).
# Legacy -OnlyMain kept ONLY *:main and deleted Slack/cron — do not use unless intentional.
param(
  [string]$AgentsRoot = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "agents"),
  [switch]$DryRun = $true,
  [switch]$OnlyMain,
  [switch]$IncludeCron,
  [switch]$AllowEmptyManifest,
  [int]$OrphanOlderThanDays = 0
)

$ErrorActionPreference = "Stop"

function Test-EphemeralSessionKey([string]$key) {
  if ($OnlyMain) { return $key -notmatch ':main$' }
  if ($key -match ':main$') { return $false }
  if ($key -match ':slack:' -or $key -match ':dm:' -or $key -match ':webchat') { return $false }
  if ($key -match ':step4:' -or $key -match ':research:' -or $key -match ':copy:' -or $key -match ':image:') {
    return $true
  }
  if ($key -match ':cron:') { return [bool]$IncludeCron }
  return $false
}

function Register-KeepEntry(
  [System.Collections.Generic.HashSet[string]]$keepIds,
  [System.Collections.Generic.HashSet[string]]$keepFiles,
  $entry
) {
  if ($entry.sessionId) {
    $sid = [string]$entry.sessionId
    [void]$keepIds.Add($sid)
    [void]$keepFiles.Add("$sid.jsonl")
  }
  if ($entry.sessionFile) {
    [void]$keepFiles.Add([IO.Path]::GetFileName([string]$entry.sessionFile))
  }
}

function Test-KeepJsonl(
  [string]$name,
  [System.Collections.Generic.HashSet[string]]$keepIds,
  [System.Collections.Generic.HashSet[string]]$keepFiles
) {
  if ($keepFiles.Contains($name)) { return $true }
  foreach ($kid in $keepIds) {
    if ($name.StartsWith($kid, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

if (-not (Test-Path $AgentsRoot)) {
  Write-Error "Agents root not found: $AgentsRoot"
}

if ($OnlyMain) {
  Write-Warning "OnlyMain: keeps ONLY keys ending in :main — Slack/cron/step4 on publish-orchestrator WILL be removed."
}

$summary = @()

Get-ChildItem -Path $AgentsRoot -Directory | ForEach-Object {
  $agentName = $_.Name
  $sessDir = Join-Path $_.FullName "sessions"
  if (-not (Test-Path $sessDir)) { return }

  $manifestPath = Join-Path $sessDir "sessions.json"
  $keepIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $keepFiles = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $newManifest = @{}
  $removedKeys = 0

  if (Test-Path $manifestPath) {
    $raw = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
    foreach ($p in $raw.PSObject.Properties) {
      if (Test-EphemeralSessionKey $p.Name) {
        $removedKeys++
        continue
      }
      $newManifest[$p.Name] = $p.Value
      Register-KeepEntry $keepIds $keepFiles $p.Value
    }
  }

  $deleted = 0
  $cutoff = if ($OrphanOlderThanDays -gt 0) { (Get-Date).AddDays(-$OrphanOlderThanDays) } else { $null }

  Get-ChildItem -Path $sessDir -File | ForEach-Object {
    $name = $_.Name
    if ($name -eq "sessions.json") { return }
    if ($name -notlike "*.jsonl*") { return }

    $keep = Test-KeepJsonl $name $keepIds $keepFiles
    if (-not $keep -and $null -ne $cutoff -and $_.LastWriteTime -lt $cutoff) {
      $keep = $false
    } elseif (-not $keep -and $null -ne $cutoff) {
      return
    }

    if (-not $keep) {
      if ($DryRun) {
        Write-Host "[dry-run] $agentName\$name"
      } else {
        Remove-Item -LiteralPath $_.FullName -Force
      }
      $deleted++
    }
  }

  if (-not $DryRun -and (Test-Path $manifestPath)) {
    if ($newManifest.Count -gt 0) {
      $out = @{}
      foreach ($kv in $newManifest.GetEnumerator()) { $out[$kv.Key] = $kv.Value }
      ($out | ConvertTo-Json -Depth 100) | Set-Content -Path $manifestPath -Encoding UTF8
    } elseif ($AllowEmptyManifest) {
      "{}" | Set-Content -Path $manifestPath -Encoding UTF8
    } else {
      Write-Warning "$agentName : prune would empty sessions.json — file left unchanged."
    }
  }

  $summary += [PSCustomObject]@{
    agent = $agentName
    kept_keys = $newManifest.Count
    removed_keys = $removedKeys
    deleted_jsonl = $deleted
    mode = if ($DryRun) { "dry-run" } else { "applied" }
  }
}

$summary | Format-Table -AutoSize
if ($DryRun) {
  Write-Host "Dry-run. Apply: -DryRun:`$false  |  Also drop cron keys: -IncludeCron"
} else {
  Write-Host "Done. Agents root: $AgentsRoot"
}
