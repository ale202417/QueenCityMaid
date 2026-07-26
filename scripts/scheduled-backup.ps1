$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectRoot ".local-postgres\logs"
$logFile = Join-Path $logDir "backup-task.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$startedAt = Get-Date
try {
  $output = & (Join-Path $PSScriptRoot "backup-db.ps1") 2>&1
  $message = @(
    "[$($startedAt.ToString('o'))] Backup started."
    $output
    "[$((Get-Date).ToString('o'))] Backup completed."
    ""
  ) -join [Environment]::NewLine
  Add-Content -LiteralPath $logFile -Value $message
} catch {
  $message = @(
    "[$($startedAt.ToString('o'))] Backup started."
    "[$((Get-Date).ToString('o'))] Backup failed: $($_.Exception.Message)"
    ""
  ) -join [Environment]::NewLine
  Add-Content -LiteralPath $logFile -Value $message
  throw
}
