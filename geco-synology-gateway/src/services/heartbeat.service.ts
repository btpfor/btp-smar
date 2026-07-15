import { env, VERSION } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { db } from "../database/sqlite.js";
import * as api from "./api.service.js";
import * as smb from "./smb-storage.service.js";

interface HeartbeatState {
  lastSentAt: number | null;
  lastOk: boolean;
  lastError: string | null;
}

export const heartbeatState: HeartbeatState = {
  lastSentAt: null,
  lastOk: false,
  lastError: null,
};

let timer: NodeJS.Timeout | null = null;

/**
 * Construit le payload heartbeat en interrogeant réellement le NAS
 * via SMB (test de connexion + lecture racine du partage GECO).
 * Les octets total/utilisé/disponible ne sont pas exposés par SMB2 :
 * on renvoie null si aucune information fiable n'est disponible.
 */
export async function buildHeartbeatPayload(opts: {
  pendingJobs: number;
  lastSyncAt: number | null;
}): Promise<Parameters<typeof api.sendHeartbeat>[0]> {
  const smbStatus = await smb.testConnection();
  const failedCount = db
    .prepare("SELECT COUNT(*) as c FROM job_history WHERE status='FAILED'")
    .get() as { c: number };

  return {
    gatewayVersion: VERSION,
    nasHost: env.SYNOLOGY_HOST,
    nasReachable: smbStatus.ok,
    smbConnected: smbStatus.ok,
    totalBytes: null,
    usedBytes: null,
    availableBytes: null,
    lastError: smbStatus.ok ? null : smbStatus.message ?? "SMB unreachable",
    pendingJobs: opts.pendingJobs,
    failedJobs: failedCount.c,
    lastSyncAt: opts.lastSyncAt ? new Date(opts.lastSyncAt).toISOString() : null,
  };
}

export async function sendHeartbeat(opts: {
  pendingJobs: number;
  lastSyncAt: number | null;
}): Promise<void> {
  try {
    const payload = await buildHeartbeatPayload(opts);
    await api.sendHeartbeat(payload);
    heartbeatState.lastSentAt = Date.now();
    heartbeatState.lastOk = true;
    heartbeatState.lastError = null;
    logger.info(
      { nasReachable: payload.nasReachable, pending: payload.pendingJobs },
      "heartbeat sent",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    heartbeatState.lastSentAt = Date.now();
    heartbeatState.lastOk = false;
    heartbeatState.lastError = msg;
    logger.warn({ err: msg }, "heartbeat failed");
    throw err;
  }
}

export function startHeartbeatLoop(
  getContext: () => { pendingJobs: number; lastSyncAt: number | null },
): void {
  if (timer) return;
  const tick = () => {
    void sendHeartbeat(getContext()).catch(() => {
      /* déjà loggé */
    });
  };
  tick();
  timer = setInterval(tick, env.HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeatLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
