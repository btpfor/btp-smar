import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(8080),

  GECO_STORAGE_ROOT: z.string().min(1),
  GECO_CONNECTOR_ID: z.string().min(1),
  GECO_CONNECTOR_SECRET: z.string().min(32, "GECO_CONNECTOR_SECRET must be >= 32 chars"),

  GECO_API_URL: z.string().url().optional(),
  GECO_WEBHOOK_PATH: z.string().default("/api/synology/webhook"),

  MAX_FILE_SIZE: z.coerce.number().int().positive().default(5 * 1024 * 1024 * 1024),
  UPLOAD_CHUNK_SIZE: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  HMAC_TIMESTAMP_TOLERANCE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  WEBHOOK_RETRY_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  WATCHER_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  DATA_DIR: z.string().default("/app/data"),
  LOG_DIR: z.string().default("/app/logs"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("[env] Invalid configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const VERSION = "1.0.0";
