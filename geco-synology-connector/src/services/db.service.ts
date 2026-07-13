import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.js";

mkdirSync(env.DATA_DIR, { recursive: true });
const db = new Database(join(env.DATA_DIR, "connector.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_used_nonces_ts ON used_nonces(ts);

CREATE TABLE IF NOT EXISTS pending_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_next ON pending_events(next_attempt_at);

CREATE TABLE IF NOT EXISTS processed_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  action TEXT NOT NULL,
  relative_path TEXT,
  result TEXT NOT NULL,
  duration_ms INTEGER,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_logs_ts ON connector_logs(ts);

CREATE TABLE IF NOT EXISTS trash_items (
  id TEXT PRIMARY KEY,
  original_relative TEXT NOT NULL,
  trash_relative TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  file_id TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  destination_relative TEXT NOT NULL,
  file_name TEXT NOT NULL,
  total_size INTEGER,
  mime_type TEXT,
  temp_path TEXT NOT NULL,
  received_chunks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const cleanNonces = db.prepare("DELETE FROM used_nonces WHERE ts < ?");
setInterval(
  () => {
    const cutoff = Math.floor(Date.now() / 1000) - env.HMAC_TIMESTAMP_TOLERANCE * 2;
    cleanNonces.run(cutoff);
  },
  10 * 60 * 1000,
).unref();

export { db };
