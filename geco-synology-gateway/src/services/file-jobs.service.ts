/**
 * Consommateur des `file_jobs` (nouveau modèle documentaire GECO).
 *
 * Contrairement à `sync_jobs` (héritage), les file_jobs transportent des
 * URL signées vers le bucket de transit Supabase Storage.
 *
 *  - UPLOAD_FILE : la Gateway télécharge le blob via `transitDownloadUrl`
 *    puis l'écrit sur le Synology via SMB natif (chemin UNC + fs/promises).
 *  - READ_FILE   : la Gateway lit le fichier sur le Synology et le pousse
 *    vers `transitUploadUrl` (staging temporaire pour le user).
 *
 * Aucun secret SMB, aucune IP NAS, aucun chemin UNC ne quitte le PC :
 * le backend ne connaît QUE `synology_relative_path`.
 */
import { request as httpRequest } from "undici";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { signOutgoing, type SignedHeaders } from "../security/hmac.js";
import { sanitizeRelative } from "../security/path-security.js";
import * as smb from "./smb-storage.service.js";
import { sha256Buffer } from "./checksum.service.js";

export interface FileJob {
  id: string;
  type:
    | "UPLOAD_FILE"
    | "READ_FILE"
    | "CREATE_DIRECTORY"
    | "MOVE_FILE"
    | "RENAME_FILE"
    | "ARCHIVE_FILE"
    | "DELETE_FILE"
    | "HEALTH_CHECK"
    | "CALCULATE_CHECKSUM";
  documentId: string | null;
  versionId: string | null;
  projectId: string | null;
  payload: Record<string, unknown>;
  transitDownloadUrl?: string | null;
  transitUploadUrl?: string | null;
  transitUploadToken?: string | null;
}

function toHttpHeaders(signed: SignedHeaders, hasJsonBody: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "x-geco-gateway-id": signed["x-geco-gateway-id"],
    "x-geco-timestamp": signed["x-geco-timestamp"],
    "x-geco-nonce": signed["x-geco-nonce"],
    "x-geco-signature": signed["x-geco-signature"],
    accept: "application/json",
  };
  if (hasJsonBody) h["content-type"] = "application/json";
  return h;
}

async function apiCall<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const payload = body ? JSON.stringify(body) : "";
  const headers = toHttpHeaders(signOutgoing(method, path, payload), payload.length > 0);
  const url = new URL(path, env.GECO_API_URL);
  const res = await httpRequest(url, { method, headers, body: payload || undefined });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`API ${path} → ${res.statusCode} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function fetchFileJobs(): Promise<FileJob[]> {
  const res = await apiCall<{ jobs: FileJob[] }>("GET", "/api/public/gateway/file-jobs");
  return res.jobs ?? [];
}

async function completeFileJob(id: string, body: Record<string, unknown>): Promise<void> {
  await apiCall("POST", `/api/public/gateway/file-jobs/${id}/complete`, body);
}

async function failFileJob(id: string, error: string): Promise<void> {
  await apiCall("POST", `/api/public/gateway/file-jobs/${id}/fail`, { error });
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await httpRequest(url, { method: "GET" });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`TRANSIT_DOWNLOAD_HTTP_${res.statusCode}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function uploadBuffer(url: string, buf: Buffer, contentType: string): Promise<void> {
  const res = await httpRequest(url, {
    method: "PUT",
    headers: { "content-type": contentType, "x-upsert": "true" },
    body: buf,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const t = await res.body.text().catch(() => "");
    throw new Error(`TRANSIT_UPLOAD_HTTP_${res.statusCode} ${t}`);
  }
}

async function dispatchFileJob(job: FileJob): Promise<Record<string, unknown>> {
  const payload = job.payload ?? {};
  const rel = sanitizeRelative(String(payload.synologyRelativePath ?? ""));

  switch (job.type) {
    case "UPLOAD_FILE": {
      if (!rel) throw new Error("MISSING_SYNOLOGY_PATH");
      if (!job.transitDownloadUrl) throw new Error("MISSING_TRANSIT_URL");
      const buf = await downloadBuffer(job.transitDownloadUrl);
      const parent = rel.split("/").slice(0, -1).join("/");
      if (parent) await smb.ensureFolder(parent);
      await smb.writeFile(rel, buf);
      const checksum = sha256Buffer(buf);
      const expected = payload.expectedChecksum as string | undefined;
      if (expected && expected !== checksum) {
        throw new Error(`CHECKSUM_MISMATCH expected=${expected} got=${checksum}`);
      }
      return { checksumSha256: checksum, size: buf.length, synologyRelativePath: rel };
    }

    case "READ_FILE": {
      if (!rel) throw new Error("MISSING_SYNOLOGY_PATH");
      if (!job.transitUploadUrl) throw new Error("MISSING_TRANSIT_URL");
      const buf = await smb.readFile(rel);
      const mime = String(payload.mimeType ?? "application/octet-stream");
      await uploadBuffer(job.transitUploadUrl, buf, mime);
      return { checksumSha256: sha256Buffer(buf), size: buf.length };
    }

    case "CREATE_DIRECTORY": {
      if (!rel) throw new Error("MISSING_SYNOLOGY_PATH");
      await smb.ensureFolder(rel);
      return { created: true, path: rel };
    }

    case "MOVE_FILE":
    case "RENAME_FILE": {
      const from = sanitizeRelative(String(payload.from ?? ""));
      const to = sanitizeRelative(String(payload.to ?? ""));
      if (!from || !to) throw new Error("MISSING_FROM_OR_TO");
      await smb.rename(from, to);
      return { from, to };
    }

    case "ARCHIVE_FILE": {
      if (!rel) throw new Error("MISSING_SYNOLOGY_PATH");
      const base = rel.split("/").pop() ?? "file";
      const dest = `GECO/ARCHIVES/${Date.now()}-${base}`;
      await smb.ensureFolder("GECO/ARCHIVES");
      await smb.rename(rel, dest);
      return { archivedTo: dest };
    }

    case "DELETE_FILE": {
      if (!rel) throw new Error("MISSING_SYNOLOGY_PATH");
      await smb.unlink(rel);
      return { deleted: true, path: rel };
    }

    case "CALCULATE_CHECKSUM": {
      if (!rel) throw new Error("MISSING_SYNOLOGY_PATH");
      const buf = await smb.readFile(rel);
      return { checksumSha256: sha256Buffer(buf), size: buf.length };
    }

    case "HEALTH_CHECK": {
      const h = await smb.healthCheck();
      return h as unknown as Record<string, unknown>;
    }

    default:
      throw new Error(`UNKNOWN_FILE_JOB_TYPE:${job.type}`);
  }
}

export async function pollFileJobsOnce(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  const jobs = await fetchFileJobs();
  for (const job of jobs) {
    try {
      logger.info({ id: job.id, type: job.type }, "file_job start");
      const result = await dispatchFileJob(job);
      await completeFileJob(job.id, result);
      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ id: job.id, err: msg }, "file_job failed");
      try { await failFileJob(job.id, msg); } catch (fe) { logger.error({ fe }, "failFileJob err"); }
      failed += 1;
    }
  }
  return { processed, failed };
}
