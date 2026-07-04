<#
  compress-state.ps1 - compact Synapse's state_groups_state table.

  WHY THIS EXISTS
  WhatsApp group churn (joins/leaves/renames) makes Synapse write a new state
  group per change. state_groups_state then balloons - 100K+ rows for a single
  busy group is normal - which slabs every room-state read and is brutal on
  constrained IOPS (Oracle free tier). See SYNC-HARDENING.md risk #11.

  This runs synapse_auto_compressor (from rust-synapse-compress-state). Unlike
  the manual synapse_compress_state tool, the auto compressor walks the whole
  state_groups table itself, keeps a progress marker, and is SAFE TO RUN WHILE
  SYNAPSE IS UP: the state_groups / state_groups_state tables are append-only
  and every change is applied in an atomic transaction, so a live Synapse never
  sees a half-compressed state. No downtime, no restart required.

  HOW OFTEN
  Weekly is a sensible default for a single-user WhatsApp stack; run it more
  often right after a big bridge import (linking an account backfills a lot of
  group membership at once). It is incremental and idempotent - re-running is
  cheap and only compresses what has grown since last time.

  WHAT IT READS
  DB credentials come from infra/.env (POSTGRES_USER / POSTGRES_PASSWORD) - the
  same file docker compose uses. Nothing is hardcoded and no secret is printed.

  Usage:  powershell -ExecutionPolicy Bypass -File infra\compress-state.ps1
          powershell -ExecutionPolicy Bypass -File infra\compress-state.ps1 -ChunkSize 1000 -Chunks 200
#>
[CmdletBinding()]
param(
  [string]$InfraDir = $PSScriptRoot,
  # State groups processed per chunk. Higher = more work/RAM per chunk.
  [int]$ChunkSize = 500,
  # How many chunks to compress this run. Bump for a big first pass, then the
  # weekly incremental runs only ever have a little to do.
  [int]$Chunks = 100,
  # Pin to a specific image digest/tag for reproducibility. The repo does not
  # publish semver tags; override this if you want a newer build.
  [string]$Image = 'ghcr.io/matrix-org/rust-synapse-compress-state:latest',
  # Compose project name (see `name:` in docker-compose.yml) - used to find the
  # postgres container's docker network so we can reach it by hostname.
  [string]$Project = 'beep-beep-phase0'
)
$ErrorActionPreference = 'Stop'

# Resolve the infra dir robustly (the -File param default can arrive empty).
if ([string]::IsNullOrWhiteSpace($InfraDir)) { $InfraDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($InfraDir)) { $InfraDir = 'C:\Users\Aadarsh Upadhyay\Desktop\Beeper OSS\infra' }

$envFile = Join-Path $InfraDir '.env'
if (-not (Test-Path $envFile)) {
  Write-Host "No .env found at $envFile - copy .env.example to .env first." -ForegroundColor Red
  exit 1
}

# --- Load DB creds from .env (KEY=VALUE lines; ignore comments/blanks). --------
$dbUser = $null; $dbPass = $null
foreach ($line in Get-Content -LiteralPath $envFile) {
  $t = $line.Trim()
  if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
  $eq = $t.IndexOf('=')
  if ($eq -lt 1) { continue }
  $k = $t.Substring(0, $eq).Trim()
  $val = $t.Substring($eq + 1).Trim().Trim('"').Trim("'")
  switch ($k) {
    'POSTGRES_USER'     { $dbUser = $val }
    'POSTGRES_PASSWORD' { $dbPass = $val }
  }
}
if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = 'beep' }   # matches .env.example default
if ([string]::IsNullOrWhiteSpace($dbPass)) {
  Write-Host "POSTGRES_PASSWORD is not set in $envFile." -ForegroundColor Red
  exit 1
}

# --- Find the postgres container + the docker network it is on. ----------------
# Reaching 'postgres' by hostname requires being ON the same user-defined network.
$pgContainer = docker ps --filter "label=com.docker.compose.project=$Project" `
                         --filter "label=com.docker.compose.service=postgres" `
                         --format '{{.Names}}' | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($pgContainer)) {
  Write-Host "Could not find a running 'postgres' container for project '$Project'." -ForegroundColor Red
  Write-Host "Is the stack up? (docker compose ps)" -ForegroundColor Yellow
  exit 1
}
$network = docker inspect $pgContainer --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' |
           Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -First 1
$network = $network.Trim()
if ([string]::IsNullOrWhiteSpace($network)) {
  Write-Host "Could not determine the docker network for $pgContainer." -ForegroundColor Red
  exit 1
}

Write-Host "== compress-state =="
Write-Host "  postgres container : $pgContainer"
Write-Host "  docker network     : $network"
Write-Host "  db / user          : synapse / $dbUser"
Write-Host "  chunk size         : $ChunkSize   chunks: $Chunks"
Write-Host "  image              : $Image"
Write-Host ""

# The connection string carries the password; pass it via env so it never lands
# in a command line, docker inspect, or this script's stdout.
$connEnv = "PGCONN=postgresql://$dbUser`:$dbPass@postgres/synapse"

# Build the container command as ONE string. $PGCONN stays a shell variable
# (single-quoted here) so the password is only ever expanded inside the
# container, never on this host's command line. $ChunkSize/$Chunks are ints we
# control, so interpolating them is safe.
$innerCmd = 'synapse_auto_compressor -p "$PGCONN" -c ' + $ChunkSize + ' -n ' + $Chunks

Write-Host "Running synapse_auto_compressor (safe while Synapse is up)..."
docker run --rm `
  --network $network `
  -e $connEnv `
  $Image `
  sh -c $innerCmd

$code = $LASTEXITCODE
if ($code -eq 0) {
  Write-Host ""
  Write-Host "Done. state_groups_state compaction pass complete." -ForegroundColor Green
  Write-Host "Re-run weekly (or after a big account link) - it is incremental." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "synapse_auto_compressor exited with code $code." -ForegroundColor Red
  exit $code
}
