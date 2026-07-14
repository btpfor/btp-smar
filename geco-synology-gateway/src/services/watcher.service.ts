import chokidar from "chokidar";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * File Watcher optionnel — surveille un point de montage SMB local
 * (par ex. `/mnt/geco` monté via cifs). Active-toi seulement si
 * WATCH_LOCAL_MOUNT est défini.
 */
export function startWatcher(): void {
  const mount = process.env.WATCH_LOCAL_MOUNT;
  if (!mount) {
    logger.info("watcher désactivé (WATCH_LOCAL_MOUNT non défini)");
    return;
  }
  const w = chokidar.watch(mount, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 500 },
    depth: 10,
    persistent: true,
  });
  const emit = (type: string) => (path: string) => {
    logger.info({ type, path, root: env.GECO_STORAGE_ROOT }, "fs event");
  };
  w.on("add", emit("add"))
    .on("change", emit("change"))
    .on("unlink", emit("unlink"))
    .on("addDir", emit("addDir"))
    .on("unlinkDir", emit("unlinkDir"));
}
