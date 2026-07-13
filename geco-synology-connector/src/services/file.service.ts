import { createReadStream, createWriteStream } from "node:fs";
import { rename, unlink, mkdir, readdir, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import type { MultipartFile } from "@fastify/multipart";
import mime from "mime-types";
import {
  ensureDir,
  resolveInsideRoot,
  safeStat,
  sanitizeRelative,
  toRelative,
  trashRoot,
  tempRoot,
} from "../utils/path-security.js";
import { sha256File } from "./checksum.service.js";
import { db } from "./db.service.js";
import { env } from "../config/env.js";

export interface UploadResult {
  fileId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  checksumSha256: string;
  createdAt: string;
  status: "synchronized";
}

const insertTrash = db.prepare(
  "INSERT INTO trash_items (id, original_relative, trash_relative, deleted_at, file_id) VALUES (?, ?, ?, ?, ?)",
);
const findTrash = db.prepare("SELECT * FROM trash_items WHERE id = ?");
const deleteTrash = db.prepare("DELETE FROM trash_items WHERE id = ?");

export async function uploadFile(
  file: MultipartFile,
  destinationPath: string,
  fileId: string | undefined,
): Promise<UploadResult> {
  const destRel = sanitizeRelative(destinationPath);
  const destDirAbs = await resolveInsideRoot(destRel);
  await ensureDir(destDirAbs);

  const originalName = basename(file.filename);
  if (!originalName) throw new Error("INVALID_FILENAME");

  const tempDir = tempRoot();
  await mkdir(tempDir, { recursive: true });
  const tempPath = join(tempDir, `${Date.now()}-${randomUUID()}-${originalName}`);

  let bytesWritten = 0;
  const write = createWriteStream(tempPath);
  file.file.on("data", (c: Buffer) => {
    bytesWritten += c.length;
    if (bytesWritten > env.MAX_FILE_SIZE) file.file.destroy(new Error("FILE_TOO_LARGE"));
  });
  try {
    await pipeline(file.file, write);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }

  const checksum = await sha256File(tempPath);
  const finalAbs = join(destDirAbs, originalName);
  const existing = await safeStat(finalAbs);
  if (existing) {
    await unlink(tempPath).catch(() => undefined);
    throw new Error("FILE_CONFLICT");
  }
  await rename(tempPath, finalAbs);
  const st = await stat(finalAbs);

  return {
    fileId: fileId ?? randomUUID(),
    name: originalName,
    relativePath: toRelative(finalAbs),
    size: st.size,
    mimeType: file.mimetype || mime.lookup(originalName) || "application/octet-stream",
    checksumSha256: checksum,
    createdAt: new Date(st.mtimeMs).toISOString(),
    status: "synchronized",
  };
}

export async function listFiles(
  relativePath: string,
  opts: { page: number; limit: number; search?: string; extension?: string; sortBy: string; sortOrder: "asc" | "desc" },
) {
  const dirAbs = await resolveInsideRoot(sanitizeRelative(relativePath || "."));
  const entries = await readdir(dirAbs, { withFileTypes: true });
  const items = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith(".trash") && !e.name.startsWith(".temp"))
      .map(async (e) => {
        const abs = join(dirAbs, e.name);
        const st = await stat(abs);
        return {
          name: e.name,
          type: e.isDirectory() ? "folder" : "file",
          extension: e.isDirectory() ? null : extname(e.name).slice(1).toLowerCase() || null,
          size: e.isDirectory() ? null : st.size,
          modifiedAt: new Date(st.mtimeMs).toISOString(),
          relativePath: toRelative(abs),
        };
      }),
  );
  let filtered = items;
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter((i) => i.name.toLowerCase().includes(q));
  }
  if (opts.extension) {
    filtered = filtered.filter((i) => i.type === "folder" || i.extension === opts.extension.toLowerCase());
  }
  filtered.sort((a, b) => {
    const dir = opts.sortOrder === "asc" ? 1 : -1;
    if (opts.sortBy === "size") return dir * ((a.size ?? 0) - (b.size ?? 0));
    if (opts.sortBy === "modifiedAt") return dir * (a.modifiedAt.localeCompare(b.modifiedAt));
    return dir * a.name.localeCompare(b.name);
  });
  const total = filtered.length;
  const start = (opts.page - 1) * opts.limit;
  return { total, page: opts.page, limit: opts.limit, items: filtered.slice(start, start + opts.limit) };
}

export async function renameFile(sourceRel: string, newName: string) {
  const cleanName = basename(newName);
  if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("INVALID_NAME");
  const srcAbs = await resolveInsideRoot(sanitizeRelative(sourceRel));
  const src = await safeStat(srcAbs);
  if (!src) throw new Error("NOT_FOUND");
  const destAbs = join(dirname(srcAbs), cleanName);
  if (await safeStat(destAbs)) throw new Error("FILE_CONFLICT");
  await rename(srcAbs, destAbs);
  return { relativePath: toRelative(destAbs) };
}

export async function moveFile(sourceRel: string, destinationRel: string) {
  const srcAbs = await resolveInsideRoot(sanitizeRelative(sourceRel));
  const destAbs = await resolveInsideRoot(sanitizeRelative(destinationRel));
  const src = await safeStat(srcAbs);
  if (!src) throw new Error("NOT_FOUND");
  if (await safeStat(destAbs)) throw new Error("FILE_CONFLICT");
  await ensureDir(dirname(destAbs));
  await rename(srcAbs, destAbs);
  return { relativePath: toRelative(destAbs) };
}

export async function trashFile(sourceRel: string, fileId?: string) {
  const srcAbs = await resolveInsideRoot(sanitizeRelative(sourceRel));
  const src = await safeStat(srcAbs);
  if (!src) throw new Error("NOT_FOUND");
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const trashDir = join(trashRoot(), y, m, d);
  await mkdir(trashDir, { recursive: true });
  const id = randomUUID();
  const trashPath = join(trashDir, `${id}-${basename(srcAbs)}`);
  await rename(srcAbs, trashPath);
  const originalRel = toRelative(srcAbs);
  const trashRel = toRelative(trashPath);
  insertTrash.run(id, originalRel, trashRel, Math.floor(Date.now() / 1000), fileId ?? null);
  return { id, originalRelative: originalRel, trashRelative: trashRel };
}

export async function restoreFromTrash(id: string) {
  const row = findTrash.get(id) as
    | { id: string; original_relative: string; trash_relative: string }
    | undefined;
  if (!row) throw new Error("NOT_FOUND");
  const trashAbs = await resolveInsideRoot(row.trash_relative);
  const destAbs = await resolveInsideRoot(row.original_relative);
  if (await safeStat(destAbs)) throw new Error("FILE_CONFLICT");
  await ensureDir(dirname(destAbs));
  await rename(trashAbs, destAbs);
  deleteTrash.run(id);
  return { relativePath: toRelative(destAbs) };
}

export function openReadStream(absPath: string, start?: number, end?: number) {
  return createReadStream(absPath, start !== undefined ? { start, end } : undefined);
}
