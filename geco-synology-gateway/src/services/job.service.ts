import { db } from "../database/sqlite.js";
import { logger } from "../utils/logger.js";
import { sanitizeRelative } from "../security/path-security.js";
import * as smb from "./smb-storage.service.js";
import { sha256Buffer } from "./checksum.service.js";
import type { Job } from "./api.service.js";

const PROJECT_SUBFOLDERS = [
  "01_ADMINISTRATION",
  "02_CONTRATS",
  "03_ETUDES",
  "04_PLANS",
  "05_AUTOCAD",
  "06_BUDGET",
  "07_FACTURES",
  "08_RAPPORTS",
  "09_PHOTOS_CHANTIER",
  "10_VIDEOS",
  "11_REUNIONS",
  "12_HSE",
  "13_ARCHIVES",
];

const ROOT_FOLDERS = [
  "PROJETS",
  "DIRECTION",
  "COMPTABILITE",
  "RESSOURCES_HUMAINES",
  "APPELS_OFFRES",
  "FOURNISSEURS",
  "CLIENTS",
  "ARCHIVES",
];

const upsertHistory = db.prepare(
  `INSERT INTO job_history (id, operation, status, source_path, destination_path, last_error, started_at, completed_at)
   VALUES (@id, @operation, @status, @source_path, @destination_path, @last_error, @started_at, @completed_at)
   ON CONFLICT(id) DO UPDATE SET
     status=excluded.status, last_error=excluded.last_error, completed_at=excluded.completed_at`,
);

export async function ensureRootTree(): Promise<void> {
  for (const f of ROOT_FOLDERS) {
    await smb.ensureFolder(f);
  }
}

export async function executeJob(job: Job): Promise<Record<string, unknown>> {
  const started = Math.floor(Date.now() / 1000);
  upsertHistory.run({
    id: job.id,
    operation: job.operation,
    status: "PROCESSING",
    source_path: job.source_path,
    destination_path: job.destination_path,
    last_error: null,
    started_at: started,
    completed_at: null,
  });

  try {
    const result = await dispatch(job);
    upsertHistory.run({
      id: job.id,
      operation: job.operation,
      status: "COMPLETED",
      source_path: job.source_path,
      destination_path: job.destination_path,
      last_error: null,
      started_at: started,
      completed_at: Math.floor(Date.now() / 1000),
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    upsertHistory.run({
      id: job.id,
      operation: job.operation,
      status: "FAILED",
      source_path: job.source_path,
      destination_path: job.destination_path,
      last_error: msg,
      started_at: started,
      completed_at: Math.floor(Date.now() / 1000),
    });
    throw err;
  }
}

async function dispatch(job: Job): Promise<Record<string, unknown>> {
  logger.info({ id: job.id, op: job.operation }, "executing job");
  switch (job.operation) {
    case "CREATE_FOLDER": {
      const path = sanitizeRelative(String(job.destination_path ?? job.source_path ?? ""));
      await smb.ensureFolder(path);
      return { created: true, path };
    }

    case "CREATE_PROJECT_STRUCTURE": {
      const code = String(job.payload.projectCode ?? "");
      const name = String(job.payload.projectName ?? "");
      if (!code) throw new Error("projectCode required");
      const slug = `${code}-${name}`.replace(/[^\w\-]+/g, "_").slice(0, 120);
      const root = `PROJETS/${slug}`;
      await smb.ensureFolder(root);
      for (const sub of PROJECT_SUBFOLDERS) {
        await smb.ensureFolder(`${root}/${sub}`);
      }
      return { created: true, root };
    }

    case "UPLOAD_FILE": {
      const dest = sanitizeRelative(String(job.destination_path ?? ""));
      const b64 = String(job.payload.contentBase64 ?? "");
      if (!dest || !b64) throw new Error("destination_path and payload.contentBase64 required");
      const buf = Buffer.from(b64, "base64");
      const parent = dest.split("/").slice(0, -1).join("/");
      if (parent) await smb.ensureFolder(parent);
      await smb.writeFile(dest, buf);
      return { path: dest, size: buf.length, checksumSha256: sha256Buffer(buf) };
    }

    case "DOWNLOAD_FILE": {
      const src = sanitizeRelative(String(job.source_path ?? ""));
      const buf = await smb.readFile(src);
      return {
        path: src,
        size: buf.length,
        checksumSha256: sha256Buffer(buf),
        contentBase64: buf.toString("base64"),
      };
    }

    case "RENAME_FILE":
    case "MOVE_FILE": {
      const from = sanitizeRelative(String(job.source_path ?? ""));
      const to = sanitizeRelative(String(job.destination_path ?? ""));
      await smb.rename(from, to);
      return { from, to };
    }

    case "DELETE_FILE": {
      const path = sanitizeRelative(String(job.source_path ?? ""));
      await smb.unlink(path);
      return { deleted: true, path };
    }

    case "RESTORE_FILE": {
      const from = sanitizeRelative(String(job.source_path ?? ""));
      const to = sanitizeRelative(String(job.destination_path ?? ""));
      await smb.rename(from, to);
      return { restored: true, from, to };
    }

    case "CALCULATE_CHECKSUM": {
      const src = sanitizeRelative(String(job.source_path ?? ""));
      const buf = await smb.readFile(src);
      return { path: src, size: buf.length, checksumSha256: sha256Buffer(buf) };
    }

    case "SCAN_FOLDER": {
      const src = sanitizeRelative(String(job.source_path ?? ""));
      const items = await smb.listDir(src);
      return { path: src, entries: items };
    }

    case "SYNC_METADATA": {
      const src = sanitizeRelative(String(job.source_path ?? ""));
      const st = await smb.stat(src);
      return { path: src, stat: st };
    }

    case "GATEWAY_DIAGNOSTIC": {
      const steps: Array<{ name: string; ok: boolean; detail?: string; ms: number }> = [];
      const run = async (name: string, fn: () => Promise<string | void>) => {
        const t0 = Date.now();
        try {
          const detail = await fn();
          steps.push({ name, ok: true, detail: detail || undefined, ms: Date.now() - t0 });
        } catch (e) {
          steps.push({
            name,
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
            ms: Date.now() - t0,
          });
        }
      };

      await run("SMB — connexion au partage GECO", async () => {
        const r = await smb.testConnection();
        if (!r.ok) throw new Error(r.message ?? "connexion refusée");
        return "partage accessible";
      });

      await run("SMB — lecture de la racine", async () => {
        const items = await smb.listDir("");
        return `${items.length} entrée(s) : ${items.slice(0, 8).join(", ")}${items.length > 8 ? "…" : ""}`;
      });

      const diagFolder = ".diagnostic";
      const fname = `${diagFolder}/diag-${Date.now()}.txt`;
      const payload = Buffer.from(`GECO diagnostic ${new Date().toISOString()}\n`);

      await run("SMB — création du dossier .diagnostic", async () => {
        await smb.ensureFolder(diagFolder);
        return diagFolder;
      });

      await run("SMB — écriture d'un fichier test", async () => {
        await smb.writeFile(fname, payload);
        return `${payload.length} octets écrits`;
      });

      await run("SMB — relecture et vérification", async () => {
        const back = await smb.readFile(fname);
        if (back.length !== payload.length || !back.equals(payload)) {
          throw new Error("contenu relu incohérent");
        }
        return "contenu identique";
      });

      await run("SMB — suppression du fichier test", async () => {
        await smb.unlink(fname);
        return "fichier supprimé";
      });

      const allOk = steps.every((s) => s.ok);
      const rootStat = await smb.stat("");
      return {
        allOk,
        steps,
        nasHost: env.SYNOLOGY_HOST,
        share: env.SYNOLOGY_SMB_SHARE,
        root: env.GECO_STORAGE_ROOT,
        rootStat,
        gatewayVersion: undefined,
        checkedAt: new Date().toISOString(),
      };
    }

    default:
      throw new Error(`UNKNOWN_OPERATION:${job.operation}`);
  }
}
