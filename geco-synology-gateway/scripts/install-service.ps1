<#
.SYNOPSIS
  Installe le GECO Synology Gateway comme service Windows (démarrage automatique).

.DESCRIPTION
  - Vérifie la présence de Node.js et du dossier de build (dist/index.js).
  - Compile le projet si dist/ est absent.
  - Télécharge NSSM (Non-Sucking Service Manager) dans .\tools\nssm si absent.
  - Installe/reconfigure le service Windows « GECOGateway » avec démarrage
    automatique, redémarrage sur crash, et journalisation dans .\logs\.
  - Démarre le service et affiche son état.

.PARAMETER ServiceName
  Nom du service Windows. Défaut : GECOGateway.

.PARAMETER NodePath
  Chemin absolu vers node.exe. Défaut : détection via `where.exe node`.

.NOTES
  Doit être lancé dans une PowerShell **Administrateur**, depuis la racine
  du dossier geco-synology-gateway.

.EXAMPLE
  PS C:\GECO\geco-synology-gateway> .\scripts\install-service.ps1
#>

[CmdletBinding()]
param(
  [string]$ServiceName = "GECOGateway",
  [string]$NodePath    = ""
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object System.Security.Principal.WindowsPrincipal($id)
  if (-not $pr.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être exécuté dans une PowerShell Administrateur."
  }
}

function Resolve-Node {
  param([string]$Explicit)
  if ($Explicit) {
    if (-not (Test-Path $Explicit)) { throw "NodePath introuvable : $Explicit" }
    return (Resolve-Path $Explicit).Path
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "node.exe introuvable dans le PATH. Installez Node.js LTS puis relancez." }
  return $cmd.Source
}

function Ensure-Nssm {
  param([string]$ProjectRoot)
  $toolsDir = Join-Path $ProjectRoot "tools\nssm"
  $nssmExe  = Join-Path $toolsDir "nssm.exe"
  if (Test-Path $nssmExe) { return $nssmExe }

  Write-Host "→ Téléchargement de NSSM (Non-Sucking Service Manager)…"
  $zipUrl  = "https://nssm.cc/release/nssm-2.24.zip"
  $zipPath = Join-Path $env:TEMP "nssm-2.24.zip"
  $extract = Join-Path $env:TEMP "nssm-2.24-extract"

  Remove-Item $zipPath, $extract -Recurse -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $extract -Force

  $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
  $src  = Get-ChildItem -Path $extract -Recurse -Filter nssm.exe |
          Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
  if (-not $src) { throw "Impossible de trouver nssm.exe dans l'archive téléchargée." }

  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  Copy-Item $src.FullName $nssmExe -Force
  Remove-Item $zipPath, $extract -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  NSSM installé dans $nssmExe"
  return $nssmExe
}

# ---------------------------------------------------------------------------

Assert-Admin

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot
Write-Host "→ Dossier projet : $ProjectRoot"

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
  throw "Fichier .env manquant. Copiez d'abord .env.example vers .env et renseignez-le."
}

$nodeExe = Resolve-Node -Explicit $NodePath
Write-Host "→ node.exe       : $nodeExe"

$entry = Join-Path $ProjectRoot "dist\index.js"
if (-not (Test-Path $entry)) {
  Write-Host "→ dist/ absent — compilation TypeScript (npm run build)…"
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install a échoué." }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build a échoué." }
}
if (-not (Test-Path $entry)) { throw "Fichier compilé introuvable : $entry" }
Write-Host "→ Entrée service : $entry"

$logDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$nssm = Ensure-Nssm -ProjectRoot $ProjectRoot

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "→ Service $ServiceName déjà présent — mise à jour de la configuration."
  if ($existing.Status -eq "Running") { & $nssm stop $ServiceName | Out-Null }
} else {
  Write-Host "→ Installation du service $ServiceName…"
  & $nssm install $ServiceName $nodeExe $entry
  if ($LASTEXITCODE -ne 0) { throw "nssm install a échoué (code $LASTEXITCODE)." }
}

# Configuration idempotente
& $nssm set $ServiceName Application       $nodeExe                          | Out-Null
& $nssm set $ServiceName AppParameters     $entry                            | Out-Null
& $nssm set $ServiceName AppDirectory      $ProjectRoot                      | Out-Null
& $nssm set $ServiceName AppStdout         (Join-Path $logDir "service.out.log") | Out-Null
& $nssm set $ServiceName AppStderr         (Join-Path $logDir "service.err.log") | Out-Null
& $nssm set $ServiceName AppRotateFiles    1                                 | Out-Null
& $nssm set $ServiceName AppRotateBytes    10485760                          | Out-Null
& $nssm set $ServiceName Start             SERVICE_AUTO_START                | Out-Null
& $nssm set $ServiceName AppExit           Default Restart                   | Out-Null
& $nssm set $ServiceName AppRestartDelay   5000                              | Out-Null
& $nssm set $ServiceName DisplayName       "GECO Synology Gateway"           | Out-Null
& $nssm set $ServiceName Description       "Passerelle GECO ↔ Synology DS112 (HMAC/SMB)." | Out-Null

Write-Host "→ Démarrage du service…"
& $nssm start $ServiceName | Out-Null
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceName
Write-Host ""
Write-Host "✔ Service installé : $ServiceName ($($svc.Status))"
Write-Host "  Logs : $logDir\service.out.log  |  $logDir\service.err.log"
Write-Host ""
Write-Host "Commandes utiles :"
Write-Host "  Get-Service $ServiceName"
Write-Host "  Get-Content .\logs\service.out.log -Tail 30 -Wait"
Write-Host "  .\scripts\uninstall-service.ps1"
