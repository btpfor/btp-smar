<#
.SYNOPSIS
  Désinstalle le service Windows « GECOGateway » (installé via install-service.ps1).

.DESCRIPTION
  - Arrête le service s'il tourne.
  - Le supprime via NSSM (ou sc.exe en repli).
  - Conserve les logs et le dossier data/ (aucune donnée locale n'est effacée).

.PARAMETER ServiceName
  Nom du service Windows. Défaut : GECOGateway.

.NOTES
  Doit être lancé dans une PowerShell **Administrateur**.

.EXAMPLE
  PS C:\GECO\geco-synology-gateway> .\scripts\uninstall-service.ps1
#>

[CmdletBinding()]
param(
  [string]$ServiceName = "GECOGateway"
)

$ErrorActionPreference = "Stop"

$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object System.Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Ce script doit être exécuté dans une PowerShell Administrateur."
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Write-Host "ℹ Aucun service $ServiceName installé — rien à faire."
  exit 0
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nssm        = Join-Path $ProjectRoot "tools\nssm\nssm.exe"

if ($svc.Status -eq "Running") {
  Write-Host "→ Arrêt du service $ServiceName…"
  if (Test-Path $nssm) { & $nssm stop $ServiceName | Out-Null }
  else                 { Stop-Service -Name $ServiceName -Force }
  Start-Sleep -Seconds 2
}

Write-Host "→ Suppression du service $ServiceName…"
if (Test-Path $nssm) {
  & $nssm remove $ServiceName confirm | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "nssm remove a échoué (code $LASTEXITCODE)." }
} else {
  & sc.exe delete $ServiceName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "sc.exe delete a échoué (code $LASTEXITCODE)." }
}

Write-Host ""
Write-Host "✔ Service $ServiceName désinstallé."
Write-Host "  Les logs (.\logs) et données locales (.\data) sont conservés."
Write-Host "  Pour tout réinitialiser : Remove-Item .\logs, .\data -Recurse -Force"
