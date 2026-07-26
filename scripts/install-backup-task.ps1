$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupScript = Join-Path $PSScriptRoot "scheduled-backup.ps1"
$taskName = "Queen City Maid Database Backup"
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShell = (Get-Command powershell.exe).Source

$action = New-ScheduledTaskAction `
  -Execute $powerShell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`"" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "2:00 AM"
$principal = New-ScheduledTaskPrincipal `
  -UserId $identity `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Creates and restore-verifies the Queen City Maid PostgreSQL backup." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
Write-Output "$($task.TaskName) is scheduled daily at 2:00 AM with StartWhenAvailable enabled."
