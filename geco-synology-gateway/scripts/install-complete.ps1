# =============================================================================
#  GECO Synology Gateway — Installation complète sur PC Windows du LAN
#  Usage :  Clic droit → "Exécuter avec PowerShell" (en administrateur)
# =============================================================================

param(
  [string]$InstallPath = "C:\geco-gateway",
  [string]$GatewayId   = "",
  [string]$GatewaySecret = "",
  [string]$ApiUrl      = "https://btp-smar.lovable.app",
  [string]$NasHost     = "192.168.1.21",
  [string]$NasShare    = "GECO",
  [string]$NasUser     = "geco-gateway",
  [string]$NasPassword = ""
)

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }

# --- 0. Vérifier admin ---
if (-not ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Ce script doit être exécuté en administrateur."
}

# --- 1. Prérequis : Node.js LTS + Bun + Git ---
Step "Installation des prérequis (Node LTS, Bun, Git)"
foreach ($pkg in @("OpenJS.NodeJS.LTS", "Oven-sh.Bun", "Git.Git")) {
  winget list --id $pkg -e 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    winget install --id $pkg -e --silent --accept-package-agreements --accept-source-agreements
    Ok "$pkg installé"
  } else { Ok "$pkg déjà présent" }
}

# --- 2. Cloner / mettre à jour le repo ---
Step "Récupération du code Gateway"
if (-not (Test-Path $InstallPath)) {
  New-Item -ItemType Directory -Path $InstallPath | Out-Null
}
Set-Location $InstallPath
if (-not (Test-Path "$InstallPath\.git")) {
  Warn "Copie manuellement le dossier geco-synology-gateway/ depuis ton projet Lovable dans $InstallPath"
  Warn "Puis relance ce script."
  exit 1
}

# --- 3. Installer les dépendances ---
Step "Installation des dépendances npm (bun install)"
& bun install
Ok "Dépendances installées"

# --- 4. Créer le .env ---
Step "Configuration du fichier .env"
if (-not $GatewayId)     { $GatewayId     = Read-Host "GECO_GATEWAY_ID     (copie depuis Backend > Secrets)" }
if (-not $GatewaySecret) { $GatewaySecret = Read-Host "GECO_GATEWAY_SECRET (copie depuis Backend > Secrets)" -AsSecureString | ConvertFrom-SecureString -AsPlainText }

@"
GECO_GATEWAY_ID=$GatewayId
GECO_GATEWAY_SECRET=$GatewaySecret
GECO_API_URL=$ApiUrl
SYNOLOGY_HOST=$NasHost
SYNOLOGY_SHARE=$NasShare
LOG_LEVEL=info
POLL_INTERVAL_MS=5000
HEARTBEAT_INTERVAL_MS=15000
"@ | Out-File -Encoding utf8 "$InstallPath\.env"
Ok ".env créé"

# --- 5. Enregistrer les credentials SMB (chiffrés localement DPAPI) ---
Step "Enregistrement des credentials Synology (DPAPI)"
if (-not $NasPassword) {
  $NasPassword = Read-Host "Mot de passe utilisateur SMB '$NasUser'" -AsSecureString | ConvertFrom-SecureString -AsPlainText
}
$env:SYNO_USER = $NasUser
$env:SYNO_PASS = $NasPassword
& bun run credentials:set
Ok "Credentials chiffrés stockés"

# --- 6. Tester le montage SMB natif ---
Step "Test SMB natif Windows"
try {
  New-SmbMapping -RemotePath "\\$NasHost\$NasShare" -UserName $NasUser -Password $NasPassword -Persistent $true -ErrorAction Stop | Out-Null
  Ok "Partage \\$NasHost\$NasShare monté"
} catch { Warn "SMB : $($_.Exception.Message)" }

# --- 7. Diagnostic doctor ---
Step "Diagnostic (bun run doctor)"
& bun run doctor

# --- 8. Test API + Synology ---
Step "Test connexion API + Synology"
& bun run test:synology
& bun run test:gateway

# --- 9. Installer en service Windows (auto-start au boot) ---
Step "Installation en service Windows"
& powershell -ExecutionPolicy Bypass -File "$InstallPath\scripts\install-service.ps1"
Ok "Service GECO-Synology-Gateway installé"

# --- 10. Démarrer et vérifier ---
Step "Démarrage du service"
Start-Service GECO-Synology-Gateway
Start-Sleep -Seconds 5
Get-Service GECO-Synology-Gateway | Format-Table Name, Status, StartType

Write-Host "`n Installation terminée." -ForegroundColor Green
Write-Host "  → Ouvre https://btp-smar.lovable.app/synology" -ForegroundColor Green
Write-Host "  → Les voyants doivent passer au VERT sous 15 secondes.`n" -ForegroundColor Green
