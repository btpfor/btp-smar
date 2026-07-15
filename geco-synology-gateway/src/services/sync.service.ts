import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import * as api from "./api.service.js";
import { executeJob } from "./job.service.js";
import { sendHeartbeat as sendHeartbeatCore, startHeartbeatLoop } from "./heartbeat.service.js";

interface State {
  running: boolean;
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  pending: number;
  failed: number;
}

export const state: State = {
  running: false,
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
  pending: 0,
  failed: 0,
};

let pollTimer: NodeJS.Timeout | null = null;

export function startSync(): void {
  if (pollTimer) return;
  state.running = true;
  logger.info({ interval: env.POLL_INTERVAL_MS }, "sync loop started");
  pollTimer = setInterval(() => { void pollOnce(); }, env.POLL_INTERVAL_MS);
  startHeartbeatLoop(() => ({
    pendingJobs: state.pending,
    lastSyncAt: state.lastSuccessAt,
  }));
  void pollOnce();
}

export function stopSync(): void {
  state.running = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function pollOnce(): Promise<void> {
  state.lastPollAt = Date.now();
  try {
    const jobs = await api.fetchPendingJobs();
    state.pending = jobs.length;
    for (const job of jobs) {
      try {
        await api.startJob(job.id);
        const result = await executeJob(job);
        await api.completeJob(job.id, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.failed += 1;
        logger.error({ id: job.id, err: msg }, "job failed");
        try { await api.failJob(job.id, msg); } catch (fe) { logger.error({ fe }, "failJob err"); }
      }
    }
    state.lastSuccessAt = Date.now();
    state.lastError = null;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    logger.warn({ err: state.lastError }, "poll failed — Gateway hors ligne côté API");
  }
}

export async function sendHeartbeatNow(): Promise<void> {
  await sendHeartbeatCore({
    pendingJobs: state.pending,
    lastSyncAt: state.lastSuccessAt,
  });
}

