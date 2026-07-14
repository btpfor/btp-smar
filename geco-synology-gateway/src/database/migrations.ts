import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_nonces (
      nonce TEXT PRIMARY KEY,
      ts    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_used_nonces_ts ON used_nonces(ts);

    CREATE TABLE IF NOT EXISTS local_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_events_next ON local_events(next_attempt_at);

    CREATE TABLE IF NOT EXISTS job_history (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      source_path TEXT,
      destination_path TEXT,
      last_error TEXT,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Purge nonces > 24h
  db.prepare("DELETE FROM used_nonces WHERE ts < ?").run(Math.floor(Date.now() / 1000) - 86_400);
}
