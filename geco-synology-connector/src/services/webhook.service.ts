import { createHash, createHmac, randomUUID } from "node:crypto";
import { request } from "undici";
import { env } from "../config/env.js";
import { db } from "./db.service.js";
import { logger } from "../utils/logger.js";

const insert = db.prepare(
  "INSERT INTO pending_events (id, event_type, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, 0, ?, ?)",
);
const selectDue = db.prepare(
  "SELECT * FROM pending_events WHERE next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT 20",
);
const markProcessed = db.prepare("DELETE FROM pending_events WHERE id = ?");
const insertProcessed = db.prepare(
  "INSERT OR REPLACE INTO processed_events (id, event_type, processed_at) VALUES (?, ?, ?)",
);
const bumpAttempt = db.prepare(
  "UPDATE pending_events SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?",
);

const BACKOFFS = [30, 60, 300, 900, 3600, 3600 * 6, 3600 * 24];

export interface SyncEvent {
  eventType:
    | "FILE_CREATED"
    | "FILE_UPDATED"
    | "FILE_DELETED"
    | "FILE_MOVED"
    | "FILE_RENAMED"
    | "FOLDER_CREATED";
  relativePath: string;
  previousPath?: string;
  fileName?: string;
  size?: number | null;
  checksumSha256?: string | null;
}

export function enqueueEvent(evt: SyncEvent) {
  const id = randomUUID();
  const payload = {
    eventId: id,
    eventType: evt.eventType,
    relativePath: evt.relativePath,
    previousPath: evt.previousPath ?? null,
    fileName: evt.fileName ?? null,
    size: evt.size ?? null,
    checksumSha256: evt.checksumSha256 ?? null,
    eventTimestamp: new Date().toISOString(),
    connectorId: env.GECO_CONNECTOR_ID,
  };
  insert.run(
    id,
    evt.eventType,
    JSON.stringify(payload),
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
  );
  processDue().catch((err) => logger.error({ err }, "webhook process error"));
}

async function processDue() {
  if (!env.WEBHOOK_RETRY_ENABLED || !env.GECO_API_URL) return;
  const now = Math.floor(Date.now() / 1000);
  const rows = selectDue.all(now) as Array<{
    id: string;
    event_type: string;
    payload: string;
    attempts: number;
  }>;
  for (const row of rows) {
    try {
      await sendWebhook(row.payload);
      markProcessed.run(row.id);
      insertProcessed.run(row.id, row.event_type, Math.floor(Date.now() / 1000));
    } catch (err) {
      const backoff = BACKOFFS[Math.min(row.attempts, BACKOFFS.length - 1)];
      const next = Math.floor(Date.now() / 1000) + backoff;
      bumpAttempt.run(next, err instanceof Error ? err.message : String(err), row.id);
      logger.warn({ id: row.id, attempts: row.attempts + 1, err }, "webhook retry scheduled");
    }
  }
}

async function sendWebhook(rawBody: string) {
  const url = new URL(env.GECO_WEBHOOK_PATH, env.GECO_API_URL!).toString();
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const canonical = ["POST", new URL(url).pathname, ts, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", env.GECO_CONNECTOR_SECRET).update(canonical).digest("hex");

  const res = await request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-geco-connector-id": env.GECO_CONNECTOR_ID,
      "x-geco-timestamp": ts,
      "x-geco-nonce": nonce,
      "x-geco-signature": signature,
    },
    body: rawBody,
  });
  if (res.statusCode >= 300) {
    const txt = await res.body.text().catch(() => "");
    throw new Error(`Webhook HTTP ${res.statusCode}: ${txt.slice(0, 200)}`);
  }
  await res.body.dump();
}

export function startWebhookLoop() {
  setInterval(() => {
    processDue().catch((err) => logger.error({ err }, "webhook loop error"));
  }, 15_000).unref();
}

export function getQueueStats() {
  const pending = db.prepare("SELECT COUNT(*) as c FROM pending_events").get() as { c: number };
  const errors = db
    .prepare("SELECT COUNT(*) as c FROM pending_events WHERE attempts > 0")
    .get() as { c: number };
  const lastProcessed = db
    .prepare("SELECT processed_at FROM processed_events ORDER BY processed_at DESC LIMIT 1")
    .get() as { processed_at: number } | undefined;
  return {
    pending: pending.c,
    withErrors: errors.c,
    lastProcessedAt: lastProcessed ? new Date(lastProcessed.processed_at * 1000).toISOString() : null,
  };
}
