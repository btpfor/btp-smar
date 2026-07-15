# GECO Synology Gateway — Installation sur Windows 10 / 11

Programme Node.js **réellement exécutable** qui tourne sur un PC Windows du
même réseau LAN que le **Synology DS112**. Il :

1. Se connecte au partage SMB `GECO` du NAS.
2. Envoie toutes les 30 s un **heartbeat signé HMAC-SHA256** vers la
   plateforme GECO (Cloudflare Worker).
3. Récupère et exécute les tâches (création dossier projet, upload, etc.)
   remontées par la plateforme.

> Tant que ce programme **n'est pas démarré** sur le PC, l'interface web
> GECO affiche « **Hors ligne** ». Dès qu'un heartbeat valide est reçu,
> elle passe à « **En ligne** ».

---

## ⚠ Migration depuis les anciennes versions (`smb2` / `ntlm`)

Les versions antérieures du Gateway utilisaient les paquets npm `smb2` et
`ntlm` pour parler au DS112. Ces paquets appellent des primitives cryptographiques
héritées (`DES-ECB`, `RC4`) **désactivées par défaut dans OpenSSL 3** — donc
dans Node.js 18+ et particulièrement Node.js 22 LTS. Résultat : `ERR_OSSL_EVP_UNSUPPORTED`
au moment du `session_setup` NTLM, sans aucun moyen fiable de contourner sans
`NODE_OPTIONS=--openssl-legacy-provider` (déconseillé en production).

La version actuelle **ne dépend plus** de `smb2` ni de `ntlm`. Elle utilise
le **client SMB natif de Windows** (via `net use`) pour ouvrir la session
authentifiée, puis accède au partage en UNC (`\\HOST\GECO\...`) avec
`fs/promises`. Aucun code NTLM n'est exécuté côté Node.js.

Après un `git pull`, exécuter :

```powershell
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
npm ls smb2   # doit répondre "(empty)"
npm ls ntlm   # doit répondre "(empty)"
```

---



## 1. Installer Node.js LTS

Télécharger et installer **Node.js 20 LTS (ou plus récent)** pour Windows :
<https://nodejs.org/en/download>

Vérifier dans une nouvelle fenêtre PowerShell :

```powershell
node -v   # doit afficher v20.x.x ou plus
npm -v
```

## 2. Ouvrir PowerShell

Menu Démarrer → taper `PowerShell` → **Windows PowerShell**.

Si l'exécution de scripts est bloquée, autoriser les scripts locaux (une
seule fois, session utilisateur uniquement) :

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## 3. Accéder au dossier `geco-synology-gateway`

Copier le dossier `geco-synology-gateway/` du dépôt sur le PC (par
exemple sous `C:\GECO\geco-synology-gateway`) puis :

```powershell
cd C:\GECO\geco-synology-gateway
```

## 4. Installer les dépendances

```powershell
npm install
```

> `better-sqlite3` est compilé nativement. Sur Windows, npm télécharge
> automatiquement un binaire prêt pour Node 20. En cas d'erreur de
> compilation, installer les Build Tools :
> `npm install --global --production windows-build-tools` puis relancer
> `npm install`.

## 5. Copier `.env.example` vers `.env`

```powershell
Copy-Item .env.example .env
```

## 6. Configurer les variables

Éditer `.env` (Bloc-notes ou VS Code) et renseigner **au minimum** :

| Variable | Valeur |
|---|---|
| `GECO_GATEWAY_ID` | `geco-gateway-01` (déjà pré-rempli — ne pas changer sans mettre à jour côté plateforme) |
| `GECO_GATEWAY_SECRET` | Le secret HMAC (≥ 64 caractères) — **identique à celui configuré dans la plateforme GECO** |
| `GECO_API_URL` | `https://btp-smar.lovable.app` |
| `SYNOLOGY_HOST` | IP ou nom LAN du DS112 (ex. `192.168.1.10`) |
| `SYNOLOGY_SMB_SHARE` | `GECO` |
| `SYNOLOGY_SMB_USERNAME` | `geco_connector` (**optionnel** si stocké dans Credential Manager, voir §6-bis) |
| `SYNOLOGY_SMB_PASSWORD` | Mot de passe SMB (**optionnel** si stocké dans Credential Manager) |

Optionnel, tolérance de reconnexion (valeurs par défaut sensées) :

| Variable | Défaut | Rôle |
|---|---|---|
| `SMB_RECONNECT_MAX_RETRIES` | `6` | Nombre max de tentatives par opération SMB avant abandon |
| `SMB_RECONNECT_MIN_DELAY_MS` | `500` | Délai initial du backoff exponentiel |
| `SMB_RECONNECT_MAX_DELAY_MS` | `30000` | Plafond du délai entre deux tentatives |

⚠️ **Ne jamais** committer ce fichier `.env`. Le `.gitignore` l'exclut déjà.
Le mot de passe SMB n'est **jamais** loggué : les scripts scrubbent toute occurrence
avant affichage et ne l'envoient **jamais** à Cloudflare.

## 6-bis. (Recommandé) Stocker les identifiants dans Windows Credential Manager

Plutôt que de laisser `SYNOLOGY_SMB_PASSWORD` en clair dans `.env`, vous pouvez
les stocker dans le coffre-fort natif de Windows (`cmdkey`) — le Gateway les
récupère alors automatiquement au moment du montage UNC, sans qu'aucun mot de
passe ne transite par Node.js ni par un fichier de configuration.

```powershell
# Écrit l'entrée cmdkey pour SYNOLOGY_HOST (ex. 192.168.1.10) :
npm run credentials -- set geco_connector "MonMotDePasseSMB"

# Vérifie qu'elle existe :
npm run credentials -- status

# Retire les deux lignes du .env :
#   SYNOLOGY_SMB_USERNAME=...
#   SYNOLOGY_SMB_PASSWORD=...

# Pour supprimer plus tard :
npm run credentials -- delete
```

L'entrée cmdkey est liée à la session utilisateur Windows sous laquelle tourne
le Gateway — pensez à la recréer sous le compte du service (via `runas` ou
directement depuis la session du compte de service NSSM) si vous utilisez
l'installation en service Windows.

## 6-ter. Reconnexion automatique

Le Gateway rétablit automatiquement la session UNC (`net use`) lorsqu'elle
tombe (NAS redémarré, câble déconnecté, session expirée). Chaque opération
SMB (`read`, `write`, `list`, `stat`, …) est protégée par un backoff
exponentiel avec jitter piloté par les variables `SMB_RECONNECT_*` ci-dessus.
En cas d'erreur transitoire (`ECONNRESET`, « The specified network name is
no longer available », `ETIMEDOUT`, …), le partage est démonté puis remonté
avant la tentative suivante — aucune intervention manuelle n'est requise.



## 7. Vérifier l'environnement (`npm run doctor`)

```powershell
npm run doctor
```

Affiche version Node, version OpenSSL, plate-forme, et la configuration
(mot de passe masqué). Doit se terminer par `✔ Environnement valide.`.

## 7-bis. Tester la connexion Synology

```powershell
npm run test:synology
```

Sortie attendue :

```
[OK] DNS résolu : 192.168.1.10 → 192.168.1.10
[OK] Port SMB 445 accessible
[OK] Partage GECO accessible
[OK] Lecture autorisée (listing racine du partage)
[OK] Écriture autorisée (48 octets → .diagnostic/test-windows-…)
[OK] Relecture identique (checksum contenu OK)
[OK] Suppression du fichier temporaire réussie
```

Si une ligne échoue, le message d'erreur SMB brut du DS112 est affiché
(port 445 bloqué, mot de passe invalide, partage inexistant, etc.).

## 8. Démarrer le Gateway avec `npm run dev`

```powershell
npm run dev
```

Le service Fastify démarre en local (`http://127.0.0.1:8787/health`), la
boucle de synchronisation tourne toutes les 5 s, et un heartbeat signé
HMAC part vers Cloudflare toutes les 30 s.

Pour un démarrage compilé (plus léger) :

```powershell
npm run build
npm start
```

## 9. Vérifier le heartbeat

Depuis une **autre** fenêtre PowerShell (le Gateway continue de tourner) :

```powershell
cd C:\GECO\geco-synology-gateway
npm run test:gateway
```

Sortie attendue :

```
[OK] API GECO accessible (HTTP 200 sur https://btp-smar.lovable.app)
[OK] Gateway ID accepté
[OK] Signature HMAC acceptée
[OK] Heartbeat envoyé (HTTP 200)
```

Ensuite dans l'application GECO → **Administration → Stockage & Synology** :
le badge doit passer à **« Connecté »** sous 30 à 60 secondes.

## 10. Installer le Gateway comme service Windows (démarrage automatique)

Utiliser **NSSM** (Non-Sucking Service Manager) — recommandé sur Windows :

```powershell
# En PowerShell administrateur :
choco install nssm            # ou télécharger https://nssm.cc/

cd C:\GECO\geco-synology-gateway
npm run build

nssm install GECOGateway "C:\Program Files\nodejs\node.exe" "C:\GECO\geco-synology-gateway\dist\index.js"
nssm set   GECOGateway AppDirectory "C:\GECO\geco-synology-gateway"
nssm set   GECOGateway AppStdout    "C:\GECO\geco-synology-gateway\logs\service.out.log"
nssm set   GECOGateway AppStderr    "C:\GECO\geco-synology-gateway\logs\service.err.log"
nssm set   GECOGateway Start        SERVICE_AUTO_START

nssm start GECOGateway
```

Vérifier :

```powershell
Get-Service GECOGateway
Get-Content .\logs\service.out.log -Tail 20 -Wait
```

Pour arrêter / retirer :

```powershell
nssm stop   GECOGateway
nssm remove GECOGateway confirm
```

---

## Scripts npm disponibles

| Commande | Rôle |
|---|---|
| `npm run dev` | Démarre le Gateway en mode watch (tsx). |
| `npm run build` | Compile TypeScript → `dist/`. |
| `npm start` | Démarre le Gateway compilé (`dist/index.js`). |
| `npm run doctor` | Vérifie l'environnement Windows (Node, OpenSSL, config, credentials). |
| `npm run credentials -- set/status/delete` | Gère les identifiants SMB dans Windows Credential Manager. |
| `npm run test:synology` | Test réel SMB : DNS, port 445, partage, R/W. |
| `npm run test:gateway` | Test réel HMAC vers l'API GECO Cloudflare. |

## Sécurité

- Le secret `GECO_GATEWAY_SECRET` **n'est jamais** écrit en dur, jamais
  loggué, jamais affiché par les scripts de test (seule sa longueur est
  affichée).
- Toutes les requêtes sortantes vers Cloudflare sont signées HMAC-SHA256
  sur `METHOD\nPATH\nTIMESTAMP\nNONCE\nsha256(body)`.
- Aucun port entrant n'est exposé à Internet : le Gateway ne fait que des
  connexions **sortantes** vers Cloudflare et **latérales** vers le DS112
  sur le port SMB 445 du LAN.
