import { pino } from "pino";
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env.js";

mkdirSync(env.LOG_DIR, { recursive: true });

// Rotation simple par date (Synology gère la conservation via montage hôte)
const dateStamp = new Date().toISOString().slice(0, 10);
const fileStream = createWriteStream(join(env.LOG_DIR, `connector-${dateStamp}.log`), { flags: "a" });

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: "geco-synology-connector", connectorId: env.GECO_CONNECTOR_ID },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers['x-geco-signature']",
        "req.headers.cookie",
        "*.password",
        "*.secret",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: fileStream },
  ]),
);
