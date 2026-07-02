<#
  docker-up.ps1 - reliable, self-healing bring-up for the beep-beep-oss Phase 0 stack.

  WHY THIS EXISTS
  Docker Desktop 4.78 on this machine recurringly crashes at startup because it cannot
  bind its AF_UNIX helper sockets (Model Runner "Inference", then "Secrets Engine")
  under %LOCALAPPDATA%. After an unclean shutdown those 0-byte socket files are orphaned
  and Windows cannot delete them ("The file cannot be accessed by the system"), so Docker
  aborts the whole engine. This script sweeps the socket dirs aside (delete fails, RENAME
  works) and starts Docker the safe way.

  TWO TOKEN-BURN TRAPS THIS AVOIDS ON PURPOSE:
   1. Never launch Docker AND wait for it in the same command: on a tool-timeout the
      force-kill cascades and kills the Docker you just started. Launch, then poll separately.
   2. Never call bare 'docker info' / 'docker version' when the daemon may be down - they
      HANG. Gate behind a named-pipe check and run docker via Start-Job with a timeout.

  IF a FRESH socket still fails to bind after a sweep, the orphaned sockets are stuck in
  the KERNEL -> REBOOT clears them, then re-run this script.

  Usage:  powershell -ExecutionPolicy Bypass -File infra\docker-up.ps1
#>
[CmdletBinding()]
param(
  [string]$InfraDir  = $PSScriptRoot,
  [string]$DockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
)
$env:WSL_UTF8 = 1

# Resolve the infra dir robustly (the param default via -File can arrive empty).
if ([string]::IsNullOrWhiteSpace($InfraDir)) { $InfraDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($InfraDir)) { $InfraDir = 'C:\Users\Aadarsh Upadhyay\Desktop\Beeper OSS\infra' }

function Test-Engine {
  # server version string if the daemon answers, else $null. Never hangs.
  if (-not ((Get-ChildItem '\\.\pipe\' -ErrorAction SilentlyContinue).Name -contains 'dockerDesktopLinuxEngine')) { return $null }
  $j = Start-Job { docker version --format '{{.Server.Version}}' }
  $v = $null
  if (Wait-Job $j -Timeout 8) { $v = Receive-Job $j }
  Stop-Job $j -ErrorAction SilentlyContinue; Remove-Job $j -Force -ErrorAction SilentlyContinue
  if ($v) { $v } else { $null }
}

function Clear-StaleSockets {
  $ts = Get-Date -Format 'yyyyMMddHHmmss'
  $targets = New-Object System.Collections.Generic.List[string]
  $targets.Add("$env:LOCALAPPDATA\Docker\run")
  Get-ChildItem $env:LOCALAPPDATA -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^docker' -and $_.Name -notmatch 'stale|broken' -and $_.Name -ne 'Docker' } |
    ForEach-Object {
      $sock = Get-ChildItem $_.FullName -File -Force -Recurse -Depth 1 -ErrorAction SilentlyContinue |
              Where-Object { $_.Length -eq 0 -or $_.Name -match '\.sock$' }
      if ($sock) { $targets.Add($_.FullName) }
    }
  foreach ($t in ($targets | Select-Object -Unique)) {
    if (Test-Path $t) {
      $leaf = Split-Path $t -Leaf
      try { Rename-Item -LiteralPath $t -NewName "$leaf.stale.$ts" -ErrorAction Stop; Write-Host "  swept: $t" }
      catch { Write-Host "  could not move $t : $($_.Exception.Message)" }
    }
  }
}

Write-Host "== beep-beep docker-up =="
$v = Test-Engine
if ($v) {
  Write-Host "engine already up ($v)"
} else {
  Write-Host "engine down - resetting Docker Desktop..."
  Get-Process 'Docker Desktop','com.docker.backend','com.docker.build','com.docker.dev-envs','com.docker.extensions' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 4
  wsl --shutdown 2>$null
  Start-Sleep 2
  Write-Host "sweeping orphaned socket dirs..."
  Clear-StaleSockets
  try { Set-Service com.docker.service -StartupType Automatic -ErrorAction Stop; Start-Service com.docker.service -ErrorAction Stop }
  catch { Write-Host "  note: com.docker.service may need an elevated start (run this script as admin once)" }
  Write-Host "starting Docker Desktop..."
  Start-Process $DockerExe
  Write-Host "waiting for engine (up to 150s)..."
  $deadline = (Get-Date).AddSeconds(150)
  do { Start-Sleep 5; $v = Test-Engine } while (-not $v -and (Get-Date) -lt $deadline)
}

if (-not $v) {
  Write-Host ""
  Write-Host "ENGINE DID NOT START." -ForegroundColor Red
  $log = (Get-ChildItem "$env:LOCALAPPDATA\Docker\log" -Recurse -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'backend' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  if ($log) {
    $m = Select-String -Path $log -Pattern 'starting services:' -SimpleMatch | Select-Object -Last 1
    if ($m) { $l = $m.Line; $i = $l.IndexOf('starting services:'); Write-Host ("crash: " + $l.Substring($i, [Math]::Min(300, $l.Length - $i))) }
  }
  Write-Host "If this is a socket 'cannot be accessed' crash, the orphaned sockets are stuck in the kernel." -ForegroundColor Yellow
  Write-Host "=> REBOOT Windows, then re-run this script. That is the reliable reset." -ForegroundColor Yellow
  exit 1
}

Write-Host "engine up ($v). Bringing up the stack..."
docker compose --project-directory $InfraDir -f (Join-Path $InfraDir 'docker-compose.yml') up -d
docker compose --project-directory $InfraDir -f (Join-Path $InfraDir 'docker-compose.yml') ps --format 'table {{.Service}}\t{{.Status}}'
