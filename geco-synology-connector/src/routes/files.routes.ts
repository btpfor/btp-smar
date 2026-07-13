import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import mime from "mime-types";
import {
  listFiles,
  moveFile,
  openReadStream,
  renameFile,
  restoreFromTrash,
  trashFile,
  uploadFile,
} from "../services/file.service.js";
import { resolveInsideRoot, safeStat, sanitizeRelative, toRelative } from "../utils/path-security.js";
import { sha256File } from "../services/checksum.service.js";
import { enqueueEvent } from "../services/webhook.service.js";

const listQuery = z.object({
  path: z.string().default("."),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().optional(),
  extension: z.string().optional(),
  sortBy: z.enum(["name", "size", "modifiedAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const renameSchema = z.object({ sourcePath: z.string(), newName: z.string().min(1).max(255) });
const moveSchema = z.object({ sourcePath: z.string(), destinationPath: z.string() });
const deleteQuery = z.object({ path: z.string(), fileId: z.string().uuid().optional() });
const restoreSchema = z.object({ trashId: z.string().uuid() });
const checksumQuery = z.object({ path: z.string() });
const downloadQuery = z.object({ path: z.string() });

export async function fileRoutes(app: FastifyInstance) {
  app.get("/api/v1/files", async (req) => {
    const q = listQuery.parse(req.query);
    req.auditPath = q.path;
    return await listFiles(q.path, q);
  });

  app.post("/api/v1/files/upload", async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: "MULTIPART_REQUIRED" });
    let destinationPath = "";
    let fileId: string | undefined;
    let result: Awaited<ReturnType<typeof uploadFile>> | null = null;

    for await (const part of req.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "destinationPath") destinationPath = String(part.value ?? "");
        else if (part.fieldname === "fileId") fileId = String(part.value ?? "");
      } else if (part.type === "file" && part.fieldname === "file") {
        if (!destinationPath) return reply.code(400).send({ error: "MISSING_DESTINATION" });
        req.auditPath = `${destinationPath}/${part.filename}`;
        result = await uploadFile(part, destinationPath, fileId);
      }
    }
    if (!result) return reply.code(400).send({ error: "NO_FILE" });
    enqueueEvent({
      eventType: "FILE_CREATED",
      relativePath: result.relativePath,
      fileName: result.name,
      size: result.size,
      checksumSha256: result.checksumSha256,
    });
    return reply.send(result);
  });

  app.get("/api/v1/files/download", async (req, reply) => {
    const q = downloadQuery.parse(req.query);
    req.auditPath = q.path;
    const abs = await resolveInsideRoot(sanitizeRelative(q.path));
    const st = await safeStat(abs);
    if (!st || !st.isFile()) return reply.code(404).send({ error: "NOT_FOUND" });

    const range = req.headers.range;
    const mimeType = mime.lookup(abs) || "application/octet-stream";
    reply.header("Content-Type", mimeType);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Disposition", `attachment; filename="${basename(abs)}"`);

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match) {
        const start = Number.parseInt(match[1], 10);
        const end = match[2] ? Number.parseInt(match[2], 10) : st.size - 1;
        if (start >= st.size || end >= st.size) return reply.code(416).send();
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${st.size}`);
        reply.header("Content-Length", end - start + 1);
        return reply.send(openReadStream(abs, start, end));
      }
    }
    reply.header("Content-Length", st.size);
    return reply.send(openReadStream(abs));
  });

  app.patch("/api/v1/files/rename", async (req) => {
    const b = renameSchema.parse(req.body);
    req.auditPath = b.sourcePath;
    const r = await renameFile(b.sourcePath, b.newName);
    enqueueEvent({ eventType: "FILE_RENAMED", relativePath: r.relativePath, previousPath: b.sourcePath });
    return r;
  });

  app.patch("/api/v1/files/move", async (req) => {
    const b = moveSchema.parse(req.body);
    req.auditPath = b.sourcePath;
    const r = await moveFile(b.sourcePath, b.destinationPath);
    enqueueEvent({ eventType: "FILE_MOVED", relativePath: r.relativePath, previousPath: b.sourcePath });
    return r;
  });

  app.delete("/api/v1/files", async (req) => {
    const q = deleteQuery.parse(req.query);
    req.auditPath = q.path;
    const r = await trashFile(q.path, q.fileId);
    enqueueEvent({ eventType: "FILE_DELETED", relativePath: r.originalRelative });
    return r;
  });

  app.post("/api/v1/files/restore", async (req) => {
    const b = restoreSchema.parse(req.body);
    const r = await restoreFromTrash(b.trashId);
    enqueueEvent({ eventType: "FILE_CREATED", relativePath: r.relativePath });
    return r;
  });

  app.get("/api/v1/files/checksum", async (req, reply) => {
    const q = checksumQuery.parse(req.query);
    req.auditPath = q.path;
    const abs = await resolveInsideRoot(sanitizeRelative(q.path));
    const st = await safeStat(abs);
    if (!st || !st.isFile()) return reply.code(404).send({ error: "NOT_FOUND" });
    const checksum = await sha256File(abs);
    return { relativePath: toRelative(abs), size: st.size, checksumSha256: checksum };
  });
}

export { stat };
