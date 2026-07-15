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
| `GECO_API_URL` | `https://btp-smar.touba-ndiaw01.workers.dev` |
| `SYNOLOGY_HOST` | IP ou nom LAN du DS112 (ex. `192.168.1.10`) |
| `SYNOLOGY_SMB_SHARE` | `GECO` |
| `SYNOLOGY_SMB_USERNAME` | `geco_connector` |
| `SYNOLOGY_SMB_PASSWORD` | Mot de passe du compte SMB créé sur le DSM |

⚠️ **Ne jamais** committer ce fichier `.env`. Le `.gitignore` l'exclut déjà.

## 7. Tester la connexion Synology

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
[OK] API GECO accessible (HTTP 200 sur https://btp-smar.touba-ndiaw01.workers.dev)
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
