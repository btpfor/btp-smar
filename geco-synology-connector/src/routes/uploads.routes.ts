import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../services/db.service.js";
import { env } from "../config/env.js";
import {
  ensureDir,
  resolveInsideRoot,
  safeStat,
  sanitizeRelative,
  tempRoot,
  toRelative,
} from "../utils/path-security.js";
import { sha256File } from "../services/checksum.service.js";
import { enqueueEvent } from "../services/webhook.service.js";
import mime from "mime-types";

const insertUpload = db.prepare(
  "INSERT INTO uploads (id, destination_relative, file_name, total_size, mime_type, temp_path, received_chunks, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'in_progress', ?, ?)",
);
const findUpload = db.prepare("SELECT * FROM uploads WHERE id = ?");
const bumpUpload = db.prepare(
  "UPDATE uploads SET received_chunks = received_chunks + 1, updated_at = ? WHERE id = ?",
);
const setStatus = db.prepare("UPDATE uploads SET status = ?, updated_at = ? WHERE id = ?");

interface UploadRow {
  id: string;
  destination_relative: string;
  file_name: string;
  total_size: number | null;
  mime_type: string | null;
  temp_path: string;
  received_chunks: number;
  status: string;
}

const initSchema = z.object({
  destinationPath: z.string(),
  fileName: z.string().min(1).max(255),
  totalSize: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
});

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/api/v1/uploads/init", async (req, reply) => {
    const b = initSchema.parse(req.body);
    if (b.totalSize && b.totalSize > env.MAX_FILE_SIZE) {
      return reply.code(413).send({ error: "FILE_TOO_LARGE" });
    }
    await resolveInsideRoot(sanitizeRelative(b.destinationPath)); // valide sécurité
    const id = randomUUID();
    await mkdir(tempRoot(), { recursive: true });
    const tempPath = join(tempRoot(), `${id}-${basename(b.fileName)}`);
    // Créer le fichier vide
    await pipeline(async function* () { yield Buffer.alloc(0); }(), createWriteStream(tempPath));
    insertUpload.run(
      id,
      sanitizeRelative(b.destinationPath),
      basename(b.fileName),
      b.totalSize ?? null,
      b.mimeType ?? mime.lookup(b.fileName) ?? null,
      tempPath,
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000),
    );
    return { uploadId: id, chunkSize: env.UPLOAD_CHUNK_SIZE };
  });

  app.post("/api/v1/uploads/:uploadId/chunks", async (req, reply) => {
    const { uploadId } = req.params as { uploadId: string };
    const row = findUpload.get(uploadId) as UploadRow | undefined;
    if (!row || row.status !== "in_progress") return reply.code(404).send({ error: "UPLOAD_NOT_FOUND" });
    if (!req.isMultipart()) return reply.code(400).send({ error: "MULTIPART_REQUIRED" });

    for await (const part of req.parts()) {
      if (part.type === "file" && part.fieldname === "chunk") {
        const write = createWriteStream(row.temp_path, { flags: "a" });
        await pipeline(part.file, write);
        bumpUpload.run(Math.floor(Date.now() / 1000), uploadId);
      }
    }
    const st = await stat(row.temp_path);
    if (st.size > env.MAX_FILE_SIZE) {
      await unlink(row.temp_path).catch(() => undefined);
      setStatus.run("failed", Math.floor(Date.now() / 1000), uploadId);
      return reply.code(413).send({ error: "FILE_TOO_LARGE" });
    }
    return { uploadId, receivedBytes: st.size };
  });

  app.post("/api/v1/uploads/:uploadId/complete", async (req, reply) => {
    const { uploadId } = req.params as { uploadId: string };
    const row = findUpload.get(uploadId) as UploadRow | undefined;
    if (!row) return reply.code(404).send({ error: "UPLOAD_NOT_FOUND" });
    const destDirAbs = await resolveInsideRoot(row.destination_relative);
    await ensureDir(destDirAbs);
    const finalAbs = join(destDirAbs, row.file_name);
    if (await safeStat(finalAbs)) {
      return reply.code(409).send({ error: "FILE_CONFLICT" });
    }
    const checksum = await sha256File(row.temp_path);
    await rename(row.temp_path, finalAbs);
    setStatus.run("completed", Math.floor(Date.now() / 1000), uploadId);
    const st = await stat(finalAbs);
    const result = {
      uploadId,
      relativePath: toRelative(finalAbs),
      size: st.size,
      checksumSha256: checksum,
      status: "synchronized" as const,
    };
    enqueueEvent({
      eventType: "FILE_CREATED",
      relativePath: result.relativePath,
      fileName: row.file_name,
      size: st.size,
      checksumSha256: checksum,
    });
    return result;
  });

  app.post("/api/v1/uploads/:uploadId/cancel", async (req, reply) => {
    const { uploadId } = req.params as { uploadId: string };
    const row = findUpload.get(uploadId) as UploadRow | undefined;
    if (!row) return reply.code(404).send({ error: "UPLOAD_NOT_FOUND" });
    await unlink(row.temp_path).catch(() => undefined);
    setStatus.run("cancelled", Math.floor(Date.now() / 1000), uploadId);
    return { uploadId, status: "cancelled" };
  });
}
