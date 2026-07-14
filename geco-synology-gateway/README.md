# GECO Synology Gateway

Service intermédiaire entre la plateforme **GECO** (hébergée sur Cloudflare) et
le **Synology DS112** utilisé comme serveur de stockage documentaire.

```
Navigateur utilisateur
      └── Plateforme GECO (Cloudflare Pages)
             └── Cloudflare Worker API
                    └── GECO Synology Gateway  ← ce projet
                           └── SMB (LAN)
                                  └── Synology DS112
```

> ⚠️ Le DS112 n'est **jamais** exposé à Internet. Aucun port entrant n'est
> ouvert sur le routeur : le Gateway établit uniquement des connexions
> **sortantes** vers Cloudflare.

## Prérequis

- Un mini-PC ou serveur Linux (Ubuntu Server 22.04+ / Debian 12 recommandé),
  ou Windows 10/11/Server, sur **le même réseau local** que le DS112.
- Node.js **≥ 20.11**.
- Le NAS Synology DS112 avec :
  - un dossier partagé nommé **`GECO`** ;
  - un compte de service nommé **`geco_connector`** (non-admin) avec les
    permissions **lecture/écriture** sur le partage `GECO` uniquement ;
  - le service **SMB** activé (Panneau de configuration → Services de fichiers).
- Une identité machine-to-machine côté plateforme GECO :
  - `GECO_GATEWAY_ID` : identifiant public du Gateway
  - `GECO_GATEWAY_SECRET` : secret HMAC (64+ caractères, généré aléatoirement)

## Installation — Ubuntu Server / Debian

```bash
# 1. Dépendances système
sudo apt update && sudo apt install -y git curl build-essential cifs-utils
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Récupération du service
sudo mkdir -p /opt/geco-gateway && sudo chown $USER /opt/geco-gateway
cd /opt/geco-gateway
git clone <URL_DU_DEPOT> .           # ou copiez le dossier geco-synology-gateway/
npm install
npm run build

# 3. Configuration
cp .env.example .env
nano .env    # renseigner GECO_GATEWAY_ID, GECO_GATEWAY_SECRET, GECO_API_URL,
             # SYNOLOGY_HOST (IP LAN du DS112), SYNOLOGY_SMB_USERNAME,
             # SYNOLOGY_SMB_PASSWORD, etc.

# 4. Service systemd
sudo tee /etc/systemd/system/geco-gateway.service > /dev/null <<'UNIT'
[Unit]
Description=GECO Synology Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/geco-gateway
EnvironmentFile=/opt/geco-gateway/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
User=nobody
Group=nogroup

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now geco-gateway
sudo journalctl -u geco-gateway -f
```

### (Optionnel) Monter le partage SMB en local

Utile si vous voulez activer le **file watcher** local (variable
`WATCH_LOCAL_MOUNT=/mnt/geco`) :

```bash
sudo mkdir -p /mnt/geco
sudo tee -a /etc/fstab > /dev/null <<'FSTAB'
//<IP_DS112>/GECO /mnt/geco cifs credentials=/etc/geco-smb.cred,uid=65534,gid=65534,iocharset=utf8,vers=3.0 0 0
FSTAB
sudo tee /etc/geco-smb.cred > /dev/null <<'CRED'
username=geco_connector
password=<votre_mot_de_passe>
domain=WORKGROUP
CRED
sudo chmod 600 /etc/geco-smb.cred
sudo mount -a
```

## Installation — Windows Service

1. Installer Node.js 20 LTS depuis <https://nodejs.org>.
2. Copier le dossier `geco-synology-gateway` dans `C:\GECO\gateway`.
3. Créer `C:\GECO\gateway\.env` à partir de `.env.example`.
4. Installer les dépendances puis compiler :
   ```powershell
   cd C:\GECO\gateway
   npm install
   npm run build
   ```
5. Installer **NSSM** (<https://nssm.cc>) et enregistrer le service :
   ```powershell
   nssm install GECOGateway "C:\Program Files\nodejs\node.exe" "C:\GECO\gateway\dist\server.js"
   nssm set GECOGateway AppDirectory "C:\GECO\gateway"
   nssm set GECOGateway AppEnvironmentExtra ":NODE_ENV=production"
   nssm start GECOGateway
   ```

## Sécurité

- Communication plateforme ↔ Gateway signée **HMAC SHA-256** (headers
  `X-GECO-Gateway-ID/Timestamp/Nonce/Signature`) avec fenêtre anti-replay.
- L'API locale du Gateway écoute uniquement sur **127.0.0.1** — elle n'est pas
  accessible depuis le LAN.
- Les identifiants SMB ne quittent **jamais** le Gateway : ni le navigateur,
  ni la plateforme GECO ne les voient.
- Protection stricte contre les *path traversal* : tout chemin est normalisé
  et refusé s'il contient `..`, un chemin absolu ou un nom réservé.

## Opérations supportées

`CREATE_FOLDER`, `CREATE_PROJECT_STRUCTURE`, `UPLOAD_FILE`, `DOWNLOAD_FILE`,
`RENAME_FILE`, `MOVE_FILE`, `DELETE_FILE`, `RESTORE_FILE`,
`CALCULATE_CHECKSUM`, `SCAN_FOLDER`, `SYNC_METADATA`.

Arborescence automatiquement créée dans le partage `GECO` au démarrage :

```
GECO/
├── PROJETS/
├── DIRECTION/
├── COMPTABILITE/
├── RESSOURCES_HUMAINES/
├── APPELS_OFFRES/
├── FOURNISSEURS/
├── CLIENTS/
└── ARCHIVES/
```

À la création d'un projet côté GECO, une tâche `CREATE_PROJECT_STRUCTURE`
génère `PROJETS/<CODE>-<NOM>/01_ADMINISTRATION` … `13_ARCHIVES`.

## Diagnostic local

```
GET  http://127.0.0.1:8787/health        → état du Gateway
GET  http://127.0.0.1:8787/smb/test      → test réel SMB vers le DS112
POST http://127.0.0.1:8787/sync/run      → force un cycle de polling
POST http://127.0.0.1:8787/heartbeat     → envoie immédiatement un heartbeat
```
