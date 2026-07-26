param(
  [string]$BackupFile
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$adminPasswordFile = Join-Path $projectRoot ".local-postgres\admin-password"
$postgresBin = if ($env:POSTGRES_BIN) {
  $env:POSTGRES_BIN
} else {
  "C:\Program Files\PostgreSQL\18\bin"
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

if (-not $BackupFile) {
  $backupDir = Get-Setting "BACKUP_DIR" (Join-Path $projectRoot ".local-postgres\backups")
  $BackupFile = Get-ChildItem -LiteralPath $backupDir -Filter "queen-city-maid-*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $BackupFile -or -not (Test-Path -LiteralPath $BackupFile)) {
  throw "No database backup was found to verify."
}
if (-not (Test-Path -LiteralPath "$BackupFile.sha256")) {
  throw "Backup checksum file is missing: $BackupFile.sha256"
}

$expectedHash = ((Get-Content -LiteralPath "$BackupFile.sha256" -Raw).Trim() -split "\s+")[0]
$actualHash = (Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) {
  throw "Backup checksum verification failed."
}

$migrationUrl = Get-Setting "MIGRATION_DATABASE_URL" (Get-Setting "DATABASE_URL")
$connection = [Uri]$migrationUrl
$ownerUser = $connection.UserInfo.Split(":", 2)[0]
$ownerPassword = $connection.UserInfo.Split(":", 2)[1]
$hostName = $connection.Host
$port = $connection.Port
$adminPassword = (Get-Content -LiteralPath $adminPasswordFile -Raw).Trim()
$databaseName = "qcm_restore_verify_$((Get-Date).ToString('yyyyMMddHHmmss'))_$((Get-Random -Maximum 999999).ToString('000000'))"
if ($databaseName -notmatch "^qcm_restore_verify_[0-9_]+$") {
  throw "Unsafe restore verification database name."
}

$createdb = Join-Path $postgresBin "createdb.exe"
$dropdb = Join-Path $postgresBin "dropdb.exe"
$pgRestore = Join-Path $postgresBin "pg_restore.exe"
$psql = Join-Path $postgresBin "psql.exe"

$env:PGPASSWORD = $adminPassword
try {
  & $createdb -h $hostName -p $port -U qcm_admin -O $ownerUser $databaseName
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the restore verification database."
  }

  $env:PGPASSWORD = $ownerPassword
  & $pgRestore --exit-on-error --no-owner --no-privileges -h $hostName -p $port -U $ownerUser -d $databaseName $BackupFile
  if ($LASTEXITCODE -ne 0) {
    throw "Backup restore verification failed."
  }

  $verification = & $psql -h $hostName -p $port -U $ownerUser -d $databaseName -Atc @"
SELECT
  (SELECT count(*) FROM schema_migrations),
  (SELECT count(*) FROM organizations),
  (SELECT count(*) FROM users),
  (SELECT count(*) FROM business_settings);
"@
  if ($LASTEXITCODE -ne 0 -or -not $verification) {
    throw "Restored database integrity query failed."
  }
  Write-Output "Restore verification passed (migrations, organizations, users, settings): $verification"
} finally {
  $env:PGPASSWORD = $adminPassword
  & $dropdb -h $hostName -p $port -U qcm_admin --if-exists --force $databaseName *> $null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
