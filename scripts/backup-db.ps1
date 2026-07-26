$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$postgresBin = if ($env:POSTGRES_BIN) {
  $env:POSTGRES_BIN
} else {
  "C:\Program Files\PostgreSQL\18\bin"
}
$pgDump = Join-Path $postgresBin "pg_dump.exe"
$pgRestore = Join-Path $postgresBin "pg_restore.exe"
$pgIsReady = Join-Path $postgresBin "pg_isready.exe"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing $envFile"
}
if (
  -not (Test-Path -LiteralPath $pgDump) -or
  -not (Test-Path -LiteralPath $pgRestore) -or
  -not (Test-Path -LiteralPath $pgIsReady)
) {
  throw "PostgreSQL tools were not found at $postgresBin"
}

function Get-Setting([string]$name, [string]$default = "") {
  $line = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match "^$([regex]::Escape($name))=" } |
    Select-Object -First 1
  if (-not $line) {
    return $default
  }
  return $line.Substring($name.Length + 1)
}

$databaseUrl = Get-Setting "MIGRATION_DATABASE_URL" (Get-Setting "DATABASE_URL")
if (-not $databaseUrl) {
  throw "MIGRATION_DATABASE_URL or DATABASE_URL is required in $envFile"
}
$backupDir = Get-Setting "BACKUP_DIR" (Join-Path $projectRoot ".local-postgres\backups")
$retentionDays = [int](Get-Setting "BACKUP_RETENTION_DAYS" "30")
if ($retentionDays -lt 1) {
  throw "BACKUP_RETENTION_DAYS must be at least 1."
}

& $pgIsReady -h 127.0.0.1 -p 55432 *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $PSScriptRoot "local-db.ps1") start
}
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $backupDir "queen-city-maid-$timestamp.dump"
$temporaryFile = "$backupFile.tmp"

try {
  & $pgDump --dbname=$databaseUrl --format=custom --no-owner --no-privileges --file=$temporaryFile
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL backup failed."
  }
  & $pgRestore --list $temporaryFile *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL could not read the completed backup."
  }
  Move-Item -LiteralPath $temporaryFile -Destination $backupFile -Force
} finally {
  if (Test-Path -LiteralPath $temporaryFile) {
    Remove-Item -LiteralPath $temporaryFile -Force
  }
}

$hash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(
  "$backupFile.sha256",
  "$hash  $([System.IO.Path]::GetFileName($backupFile))`n",
  [System.Text.UTF8Encoding]::new($false)
)

& (Join-Path $PSScriptRoot "verify-backup.ps1") -BackupFile $backupFile

$cutoff = (Get-Date).AddDays(-$retentionDays)
Get-ChildItem -LiteralPath $backupDir -File |
  Where-Object {
    $_.LastWriteTime -lt $cutoff -and
    ($_.Name -like "queen-city-maid-*.dump" -or $_.Name -like "queen-city-maid-*.dump.sha256")
  } |
  Remove-Item -Force

Write-Output "Verified database backup created: $backupFile"
