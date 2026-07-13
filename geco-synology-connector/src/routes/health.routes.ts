import type { FastifyInstance } from "fastify";
import { env, VERSION } from "../config/env.js";
import { getStorageStatus } from "../services/storage.service.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/v1/health", async () => {
    const storage = await getStorageStatus();
    return {
      status: "online",
      connector: "GECO Synology Connector",
      version: VERSION,
      serverTime: new Date().toISOString(),
      storageStatus: storage.status,
      connectorId: env.GECO_CONNECTOR_ID,
    };
  });
}
