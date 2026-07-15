import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  GECO_GATEWAY_ID: z.string().min(1),
  GECO_GATEWAY_SECRET: z.string().min(32, "GECO_GATEWAY_SECRET must be >= 32 chars"),
  GECO_API_URL: z.string().url(),

  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  SYNOLOGY_HOST: z.string().min(1).default("192.168.1.21"),
  SYNOLOGY_SMB_SHARE: z.string().min(1).default("GECO"),
  SYNOLOGY_SMB_DOMAIN: z.string().default("WORKGROUP"),
  // Les identifiants SMB peuvent être stockés dans le Windows Credential
  // Manager (via `npm run credentials -- set`). Dans ce cas ils sont absents
  // de `.env` et le Gateway s'appuie sur l'entrée cmdkey de l'hôte.
  SYNOLOGY_SMB_USERNAME: z.string().min(1).optional(),
  SYNOLOGY_SMB_PASSWORD: z.string().min(1).optional(),

  // Politique de reconnexion (mount UNC / net use).
  SMB_RECONNECT_MAX_RETRIES: z.coerce.number().int().positive().default(6),
  SMB_RECONNECT_MIN_DELAY_MS: z.coerce.number().int().positive().default(500),
  SMB_RECONNECT_MAX_DELAY_MS: z.coerce.number().int().positive().default(30_000),

  GECO_STORAGE_ROOT: z.string().default(""),

  MAX_FILE_SIZE: z.coerce.number().int().positive().default(5 * 1024 * 1024 * 1024),
  HMAC_TIMESTAMP_TOLERANCE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  DATA_DIR: z.string().default("./data"),
  LOG_DIR: z.string().default("./logs"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("[env] Invalid configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const VERSION = "1.0.0";
