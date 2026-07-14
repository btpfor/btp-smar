import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env, VERSION } from "../src/config/env.js";
import { logger } from "./utils/logger.js";
import { startSync, sendHeartbeatNow, state, pollOnce } from "./services/sync.service.js";
import { startWatcher } from "./services/watcher.service.js";
import { testConnection } from "./services/smb-storage.service.js";
import { ensureRootTree } from "./services/job.service.js";

const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

await app.register(helmet, { global: true });
await app.register(rateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: "1 minute" });

/** Endpoint local — utilisé pour diagnostic sur le LAN (non exposé à Internet). */
app.get("/health", async () => ({
  status: "online",
  service: "GECO Synology Gateway",
  version: VERSION,
  nas: env.SYNOLOGY_HOST,
  running: state.running,
  lastPollAt: state.lastPollAt,
  lastSuccessAt: state.lastSuccessAt,
  lastError: state.lastError,
}));

app.get("/smb/test", async () => await testConnection());
app.post("/sync/run", async () => { await pollOnce(); return { ok: true }; });
app.post("/heartbeat", async () => { await sendHeartbeatNow(); return { ok: true }; });

const shutdown = async (sig: string) => {
  logger.info({ sig }, "shutdown");
  try { await app.close(); } catch { /* noop */ }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  try {
    await ensureRootTree();
  } catch (err) {
    logger.warn({ err }, "ensureRootTree failed (NAS possiblement inaccessible au démarrage)");
  }
  startWatcher();
  startSync();
  await app.listen({ host: "127.0.0.1", port: env.PORT });
  logger.info(`GECO Synology Gateway v${VERSION} → http://127.0.0.1:${env.PORT}`);
}

main().catch((err) => {
  logger.fatal({ err }, "startup failed");
  process.exit(1);
});
