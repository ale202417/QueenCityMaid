$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot ".local-postgres"
$envFile = Join-Path $projectRoot ".env"
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($path in @($runtimeDir, $envFile)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required local security path is missing: $path"
  }
}

& icacls.exe $runtimeDir /reset /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not normalize the PostgreSQL runtime directory permissions."
}

& icacls.exe $runtimeDir `
  /inheritance:r `
  /grant:r "${identity}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" `
  /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not restrict the PostgreSQL runtime directory permissions."
}

& icacls.exe $envFile `
  /inheritance:r `
  /grant:r "${identity}:F" "SYSTEM:F" "Administrators:F" `
  /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not restrict the .env file permissions."
}

Write-Output "Local PostgreSQL data and credentials are restricted to $identity, SYSTEM, and Administrators."
