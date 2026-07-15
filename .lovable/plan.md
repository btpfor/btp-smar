# Refonte Stockage GECO BTP + Synology DS112

Architecture cible: Frontend → API (Cloudflare Worker) → D1 (métadonnées) + R2 (transit) → Gateway Windows (pull HMAC) → SMB natif → DS112.

Ce chantier est très large (16 axes, versioning, permissions, audit, refonte Gateway, R2, UI Documents/Projets). Je propose un découpage en **4 phases livrables** pour ne rien casser et vous laisser valider à chaque étape.

---

## Phase 1 — Fondations backend (D1 + R2 + File Jobs)

**Migrations D1**
- `documents` (logique) : id, project_id, folder_id, category, name, mime, owner_id, current_version_id, status, deleted_at, deleted_by, timestamps
- `document_versions` : id, document_id, version_number, physical_name, size, checksum_sha256, synology_relative_path, storage_status (`PENDING_STORAGE|UPLOADING|STORED|STORAGE_FAILED|ARCHIVED`), uploaded_by, gateway_id, stored_at, error_message
- `file_jobs` : id, type (`UPLOAD_FILE|READ_FILE|CREATE_DIRECTORY|MOVE_FILE|RENAME_FILE|ARCHIVE_FILE|DELETE_FILE|HEALTH_CHECK|CALCULATE_CHECKSUM`), document_id, document_version_id, project_id, gateway_id, payload jsonb (sans secrets), status, attempt_count, max_attempts, claimed_at/started_at/completed_at, error, r2_temp_key
- `document_audit` : user_id, document_id, project_id, gateway_id, action, request_id, result, created_at
- Permissions étendues : `documents.view/upload/download/rename/move/version/archive/delete` — via `user_roles` + policies RLS
- GRANTS + RLS complets sur toutes les nouvelles tables

**R2 (transit chiffré)**
- Bucket `geco-transit` (privé, clés non prévisibles, TTL logique 24h)
- Binding à ajouter à la configuration Cloudflare (je documenterai le binding exact requis)
- Politique: suppression de l'objet R2 après confirmation Gateway `STORED`

**Server functions / routes**
- `documents.upload` : crée version PENDING_STORAGE + upload R2 + crée job UPLOAD_FILE
- `documents.download` : crée job READ_FILE, renvoie URL R2 signée temporaire
- `documents.list/get/rename/move/archive/delete` (soft)
- `documents.versions.list/create`
- Routes Gateway (pull, HMAC déjà en place) : `/api/gateway/jobs/claim`, `/complete`, `/fail`, `/heartbeat` (déjà présent)

---

## Phase 2 — Refonte Gateway Windows

- **Supprimer** `smb2@0.2.11` et `ntlm@0.1.3` du `package.json`
- **Implémenter Windows SMB natif** : montage/accès via chemins UNC `\\HOST\SHARE\...` + `fs/promises` (le PC Windows monte le partage via credentials Windows ou `net use` au démarrage)
- **Nouveau `smb-storage.service.ts`** : `writeFile`, `readFile`, `mkdirp`, `move`, `rename`, `stat`, `sha256`, `exists`
- **Job runner** : pull des jobs, exécution par type, résultat signé HMAC
- **Correctifs TS** :
  - `api.service.ts` : typer `SignedHeaders` comme `Record<string, string>` compatible `HeadersInit`
  - `job.service.ts` : import correct de `env` depuis `config/env.ts`
- **Structure racine** créée à la demande : `GECO/PROJETS/[PRJ-ID]/{ADMINISTRATIF,CONTRATS,DEVIS,FACTURES,PLANS,RAPPORTS,PHOTOS,PV,AUTRES}`, `GECO/ENTREPRISE/...`, `GECO/ARCHIVES`, `GECO/GATEWAY/{TEMP,QUARANTINE}`
- **Node.js 22 LTS**, retrait de `--openssl-legacy-provider`
- **Script `npm run doctor`** : vérifie Node 22, résolution DNS SYNOLOGY_HOST, port 445, accès UNC, écriture test dans `GATEWAY/TEMP`, ping backend, signature HMAC OK
- **Commandes PowerShell** d'installation fournies dans le rapport final

---

## Phase 3 — UI Documents & intégration Projets

- **Onglet Documents projet** (`/projects/$id/documents`) avec catégories
- **Page Documents globale** : tableau (nom, projet, catégorie, type, taille, version, ajouté par, date, statut Synology, dernière sync) + filtres + recherche
- **Statuts visuels** : En attente / Transfert / Stocké / Erreur / Indisponible / Archivé
- **Actions** conditionnées permissions : Prévisualiser, Télécharger, Renommer, Déplacer, Nouvelle version, Archiver, Supprimer
- **Prévisualisation** PDF/image via route API authentifiée (jamais d'URL NAS)
- **Versioning** : historique V1..Vn, version courante mise en avant

---

## Phase 4 — Page Stockage & Synology + Audit

- Refonte `/synology` avec vraies métriques Gateway : NAS accessible, SMB, partage, lecture/écriture OK, dernier heartbeat, jobs pending/error, docs en attente/stockés, espace disque DS112 (Total/Utilisé/Dispo/%)
- Actions admin : Tester le Gateway, Synchroniser maintenant, Relancer les erreurs (job HEALTH_CHECK / retry)
- Vue Audit filtrable

---

## Rapport final (livré à la fin de la phase 4)

Sections exactes demandées : Architecture, Migrations, Tables, R2 OUI/NON + binding, Routes, File Jobs, Fichiers Gateway modifiés, SMB2/NTLM supprimés, SMB natif, Build Gateway, Doctor, PowerShell install, Variables/Secrets/Bindings Cloudflare, Test final.

---

## Détails techniques importants

- **D1 vs Supabase** : le projet actuel utilise **Supabase (Lovable Cloud)**, pas D1. J'appliquerai la même logique (métadonnées uniquement, jamais de binaires) dans Supabase Postgres + Supabase Storage (ou R2 si vous confirmez l'ajout du binding R2 côté Cloudflare Worker SSR).
- **R2** : n'est pas configuré aujourd'hui. Deux options — (A) ajouter un binding R2 via `wrangler.toml`/dashboard Cloudflare (nécessite votre action côté hébergeur Lovable), (B) utiliser Supabase Storage bucket `documents` déjà présent comme zone de transit. **Option B recommandée** car sans action infra requise ; R2 pourra remplacer plus tard sans changer l'API.
- **Aucune IP en dur**, aucun secret côté frontend, HMAC conservé.

---

## Questions avant de démarrer

1. **Transit fichiers** : je pars sur **Supabase Storage** (bucket privé `documents` déjà existant, signé, TTL court) comme zone de transit ? Ou vous confirmez l'ajout d'un binding R2 côté Cloudflare (action manuelle requise) ?
2. **Phasage** : je commence par **Phase 1 (backend + migrations)** dans ce tour, puis on enchaîne phase par phase — OK ?
3. **Données existantes** table `files` : je la garde et migre vers `documents`+`document_versions` en douceur (vue de compatibilité), ou repart à zéro ?

Je n'implémente rien avant votre validation du plan et des 3 réponses ci-dessus.
