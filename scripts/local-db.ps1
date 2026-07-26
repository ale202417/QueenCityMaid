param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $projectRoot ".local-postgres\data"
$logDir = Join-Path $projectRoot ".local-postgres\logs"
$logFile = Join-Path $logDir "postgres.log"
$port = 55432
$postgresBin = if ($env:POSTGRES_BIN) {
  $env:POSTGRES_BIN
} else {
  "C:\Program Files\PostgreSQL\18\bin"
}
$pgCtl = Join-Path $postgresBin "pg_ctl.exe"

if (-not (Test-Path -LiteralPath $pgCtl)) {
  throw "PostgreSQL tools were not found at $postgresBin"
}

if (-not (Test-Path -LiteralPath (Join-Path $dataDir "PG_VERSION"))) {
  throw "Queen City Maid database is not initialized at $dataDir"
}

function Test-DatabaseRunning {
  & $pgCtl status -D $dataDir *> $null
  return $LASTEXITCODE -eq 0
}

switch ($Action) {
  "start" {
    if (Test-DatabaseRunning) {
      Write-Output "Queen City Maid PostgreSQL is already running on port $port."
      break
    }
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    & $pgCtl start -D $dataDir -l $logFile -o "-p $port -h 127.0.0.1" -w
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL did not start. Review $logFile"
    }
    Write-Output "Queen City Maid PostgreSQL started on port $port."
  }
  "stop" {
    if (-not (Test-DatabaseRunning)) {
      Write-Output "Queen City Maid PostgreSQL is already stopped."
      break
    }
    & $pgCtl stop -D $dataDir -m fast -w
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL did not stop cleanly."
    }
    Write-Output "Queen City Maid PostgreSQL stopped."
  }
  "status" {
    if (Test-DatabaseRunning) {
      Write-Output "Queen City Maid PostgreSQL is running on port $port."
    } else {
      Write-Output "Queen City Maid PostgreSQL is stopped."
      exit 1
    }
  }
}
