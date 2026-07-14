import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.js";
import { runMigrations } from "./migrations.js";

mkdirSync(env.DATA_DIR, { recursive: true });
export const db = new Database(join(env.DATA_DIR, "gateway.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
runMigrations(db);
