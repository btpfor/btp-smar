import chokidar from "chokidar";
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { enqueueEvent } from "./webhook.service.js";
import { sha256File } from "./checksum.service.js";

const DEBOUNCE_MS = 750;
const pending = new Map<string, NodeJS.Timeout>();

function debounce(key: string, fn: () => void) {
  const prev = pending.get(key);
  if (prev) clearTimeout(prev);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      fn();
    }, DEBOUNCE_MS),
  );
}

function relPath(abs: string): string {
  return relative(env.GECO_STORAGE_ROOT, abs).split(/[\\/]/g).join("/");
}

function isIgnored(abs: string): boolean {
  const r = relPath(abs);
  return (
    r.startsWith(".trash") ||
    r.startsWith(".temp") ||
    r.startsWith("@eaDir") ||
    r.startsWith("#recycle") ||
    r.includes("/.DS_Store") ||
    r.endsWith("Thumbs.db")
  );
}

export function startWatcher() {
  if (!env.WATCHER_ENABLED) {
    logger.info("File watcher disabled");
    return;
  }
  const watcher = chokidar.watch(env.GECO_STORAGE_ROOT, {
    ignored: (p: string) => isIgnored(p),
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 20,
  });

  watcher
    .on("add", (p) =>
      debounce(`add:${p}`, async () => {
        try {
          const st = await stat(p);
          const checksum = await sha256File(p).catch(() => null);
          enqueueEvent({
            eventType: "FILE_CREATED",
            relativePath: relPath(p),
            fileName: p.split(/[\\/]/).pop() ?? "",
            size: st.size,
            checksumSha256: checksum,
          });
        } catch (err) {
          logger.warn({ err, p }, "watcher add error");
        }
      }),
    )
    .on("change", (p) =>
      debounce(`change:${p}`, async () => {
        try {
          const st = await stat(p);
          const checksum = await sha256File(p).catch(() => null);
          enqueueEvent({
            eventType: "FILE_UPDATED",
            relativePath: relPath(p),
            fileName: p.split(/[\\/]/).pop() ?? "",
            size: st.size,
            checksumSha256: checksum,
          });
        } catch (err) {
          logger.warn({ err, p }, "watcher change error");
        }
      }),
    )
    .on("unlink", (p) =>
      debounce(`unlink:${p}`, () => {
        enqueueEvent({
          eventType: "FILE_DELETED",
          relativePath: relPath(p),
          fileName: p.split(/[\\/]/).pop() ?? "",
        });
      }),
    )
    .on("addDir", (p) =>
      debounce(`addDir:${p}`, () => {
        enqueueEvent({ eventType: "FOLDER_CREATED", relativePath: relPath(p) });
      }),
    )
    .on("error", (err) => logger.error({ err }, "watcher error"));

  logger.info({ root: env.GECO_STORAGE_ROOT }, "File watcher started");
}
