import type { FastifyInstance } from "fastify";
import { getStorageStatus } from "../services/storage.service.js";
import { getQueueStats } from "../services/webhook.service.js";

export async function storageRoutes(app: FastifyInstance) {
  app.get("/api/v1/storage/status", async () => {
    const storage = await getStorageStatus();
    const queue = getQueueStats();
    return { storage, queue };
  });
}
