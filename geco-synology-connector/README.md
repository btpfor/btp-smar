# GECO Synology Connector

Service backend sécurisé (Node.js + Fastify + TypeScript) déployé en conteneur
Docker sur le NAS Synology de GECO. Il expose une API REST authentifiée en
HMAC SHA-256 utilisée exclusivement par l'API GECO (Cloudflare Workers) pour
lire et écrire dans `/volume1/GECO`.

Le navigateur des utilisateurs ne parle **jamais** directement au NAS.
Tout passe par : Plateforme GECO → Cloudflare Workers → GECO Synology Connector → NAS.

## Fonctionnalités

- Authentification machine-to-machine HMAC SHA-256 + anti-replay (nonce + timestamp)
- Sécurité stricte des chemins (anti path-traversal, résolution des symlinks)
- Racine unique autorisée : `GECO_STORAGE_ROOT` (par défaut `/data/geco`)
- Upload streaming (Fastify Multipart) + upload par chunks pour très gros fichiers
- Download streaming avec support des Range Requests
- Création automatique de l'arborescence projet (13 sous-dossiers standardisés)
- Corbeille (`.trash/AAAA/MM/JJ/`) + restauration
- Checksum SHA-256 en streaming
- File Watcher (chokidar) avec debounce → webhooks signés vers l'API GECO
- File d'attente SQLite persistante + retry exponentiel (30 s → 24 h)
- Détection de conflits SHA-256 (jamais d'écrasement automatique)
- Logs JSON structurés (Pino) + rotation quotidienne + rédaction des secrets
- Dockerfile multi-stage, utilisateur non-root, HEALTHCHECK

## Prérequis Synology

1. DSM 7.2+ avec **Container Manager** installé
2. Un utilisateur DSM dédié au conteneur (facultatif mais recommandé)
3. Le dossier partagé `GECO` créé sur `/volume1`

## Installation pas à pas

### 1. Préparer les dossiers

Se connecter en SSH au NAS puis :

```bash
sudo mkdir -p /volume1/GECO
sudo mkdir -p /volume1/docker/geco-connector/{data,logs}
sudo chown -R 10001:10001 /volume1/docker/geco-connector
sudo chown -R 10001:10001 /volume1/GECO
```

L'UID 10001 correspond à l'utilisateur `geco` créé dans l'image Docker.

### 2. Copier le projet

Copier ce dossier `geco-synology-connector/` dans
`/volume1/docker/geco-connector/app/` (par FTP, SMB ou `git clone`).

### 3. Configurer les variables d'environnement

```bash
cd /volume1/docker/geco-connector/app
cp .env.example .env
```

Générer un secret HMAC fort (à conserver aussi côté API GECO) :

```bash
openssl rand -hex 64
```

Éditer `.env` :

```
GECO_CONNECTOR_ID=synology-nas-01
GECO_CONNECTOR_SECRET=<coller la valeur générée>
GECO_API_URL=https://btp-smar.lovable.app
```

### 4. Construire et démarrer

Via SSH :

```bash
cd /volume1/docker/geco-connector/app
sudo docker compose build
sudo docker compose up -d
```

Via Container Manager (interface DSM) :

1. Projet → Créer → Chemin `/volume1/docker/geco-connector/app`
2. Source : `docker-compose.yml`
3. Construire puis Démarrer

### 5. Vérifier

```bash
curl http://<IP-NAS>:8080/api/v1/health
```

Réponse attendue :

```json
{
  "status": "online",
  "connector": "GECO Synology Connector",
  "version": "1.0.0",
  "storageStatus": "available"
}
```

### 6. Connecter la plateforme GECO

Dans GECO → Administration → Stockage & Synology, saisir :

- URL interne du connecteur (ex. `http://192.168.1.10:8080`)
- `GECO_CONNECTOR_ID`
- `GECO_CONNECTOR_SECRET` (identique au NAS)

Cliquer sur **Tester la connexion**. Le statut doit passer à *En ligne*.

### 7. Logs

```bash
sudo docker logs -f geco-synology-connector
tail -f /volume1/docker/geco-connector/logs/connector-*.log
```

## Sécurité

- Ne jamais exposer le port 8080 directement sur Internet. Le connecteur ne
  doit être joignable que par l'API GECO (VPN site-à-site, Cloudflare Tunnel,
  ou reverse proxy TLS avec IP allow-list).
- Ne jamais mettre les secrets dans `docker-compose.yml` — utiliser `.env`.
- Les logs ne contiennent aucune donnée confidentielle (signature, secret,
  cookie et token sont automatiquement masqués).
- Le conteneur tourne en utilisateur non-root avec `no-new-privileges`.

## Signature HMAC (exemple TypeScript côté GECO)

```ts
const ts = Math.floor(Date.now() / 1000).toString();
const nonce = crypto.randomUUID();
const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
const canonical = ["POST", "/api/v1/folders", ts, nonce, bodyHash].join("\n");
const signature = crypto
  .createHmac("sha256", process.env.SYNOLOGY_CONNECTOR_SECRET!)
  .update(canonical)
  .digest("hex");

await fetch(`${SYNOLOGY_URL}/api/v1/folders`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-geco-connector-id": process.env.SYNOLOGY_CONNECTOR_ID!,
    "x-geco-timestamp": ts,
    "x-geco-nonce": nonce,
    "x-geco-signature": signature,
  },
  body: rawBody,
});
```

## Endpoints

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/api/v1/health` | État du connecteur (public) |
| GET | `/api/v1/storage/status` | Espace disque + file d'attente |
| POST | `/api/v1/folders` | Créer un dossier |
| POST | `/api/v1/projects/initialize` | Créer l'arborescence projet |
| GET | `/api/v1/files` | Lister fichiers/dossiers |
| POST | `/api/v1/files/upload` | Upload multipart |
| GET | `/api/v1/files/download` | Download streaming (Range) |
| PATCH | `/api/v1/files/rename` | Renommer |
| PATCH | `/api/v1/files/move` | Déplacer |
| DELETE | `/api/v1/files` | Envoyer à la corbeille |
| POST | `/api/v1/files/restore` | Restaurer depuis la corbeille |
| GET | `/api/v1/files/checksum` | Calculer SHA-256 |
| POST | `/api/v1/uploads/init` | Initier un upload par chunks |
| POST | `/api/v1/uploads/:id/chunks` | Envoyer un chunk |
| POST | `/api/v1/uploads/:id/complete` | Finaliser |
| POST | `/api/v1/uploads/:id/cancel` | Annuler |
| GET | `/api/v1/sync/queue` | Voir la file d'attente webhooks |
| POST | `/api/v1/sync/check-conflict` | Comparer checksum plateforme ↔ NAS |
