$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$backupDir = Join-Path $projectRoot ".local-postgres\backups"
$postgresBin = if ($env:POSTGRES_BIN) {
  $env:POSTGRES_BIN
} else {
  "C:\Program Files\PostgreSQL\18\bin"
}
$failures = [System.Collections.Generic.List[string]]::new()

function Get-Setting([string]$name, [string]$default = "") {
  $line = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match "^$([regex]::Escape($name))=" } |
    Select-Object -First 1
  if (-not $line) {
    return $default
  }
  return $line.Substring($name.Length + 1)
}

& (Join-Path $postgresBin "pg_isready.exe") -h 127.0.0.1 -p 55432 *> $null
if ($LASTEXITCODE -ne 0) {
  $failures.Add("PostgreSQL is not accepting connections.")
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:4010/api/health" -TimeoutSec 5
  if ($health.data.status -ne "ok") {
    $failures.Add("The application health endpoint is not healthy.")
  }
} catch {
  $failures.Add("The application health endpoint is unavailable.")
}

$backup = Get-ChildItem -LiteralPath $backupDir -Filter "queen-city-maid-*.dump" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $backup) {
  $failures.Add("No database backup exists.")
} else {
  if ($backup.LastWriteTime -lt (Get-Date).AddHours(-26)) {
    $failures.Add("The newest database backup is more than 26 hours old.")
  }
  $checksumFile = "$($backup.FullName).sha256"
  if (-not (Test-Path -LiteralPath $checksumFile)) {
    $failures.Add("The newest database backup has no checksum.")
  } else {
    $expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split "\s+")[0]
    $actual = (Get-FileHash -LiteralPath $backup.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
      $failures.Add("The newest database backup checksum is invalid.")
    }
  }
}

try {
  $taskInfo = Get-ScheduledTaskInfo -TaskName "Queen City Maid Database Backup"
  if ($taskInfo.LastTaskResult -ne 0) {
    $failures.Add("The most recent scheduled backup task failed.")
  }
} catch {
  $failures.Add("The scheduled database backup task is missing.")
}

$databaseUrl = Get-Setting "DATABASE_URL"
$connection = [Uri]$databaseUrl
$env:PGPASSWORD = $connection.UserInfo.Split(":", 2)[1]
try {
  $privileges = & (Join-Path $postgresBin "psql.exe") `
    -h $connection.Host `
    -p $connection.Port `
    -U $connection.UserInfo.Split(":", 2)[0] `
    -d $connection.AbsolutePath.TrimStart("/") `
    -Atc "SELECT rolsuper, rolcreatedb, rolcreaterole, has_schema_privilege(current_user, 'public', 'CREATE') FROM pg_roles WHERE rolname = current_user;"
  if ($LASTEXITCODE -ne 0 -or $privileges -ne "f|f|f|f") {
    $failures.Add("The application database role has elevated privileges.")
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ($failures.Count) {
  $failures | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output "Security status passed: API, PostgreSQL, runtime privileges, scheduled task, and backup checksum are healthy."
