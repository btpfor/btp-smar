import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../services/db.service.js";
import { getQueueStats } from "../services/webhook.service.js";
import { resolveInsideRoot, safeStat, sanitizeRelative } from "../utils/path-security.js";
import { sha256File } from "../services/checksum.service.js";

const conflictSchema = z.object({
  path: z.string(),
  platformChecksumSha256: z.string().length(64),
});

export async function syncRoutes(app: FastifyInstance) {
  app.get("/api/v1/sync/queue", async () => {
    const items = db
      .prepare(
        "SELECT id, event_type, attempts, next_attempt_at, last_error, created_at FROM pending_events ORDER BY next_attempt_at ASC LIMIT 100",
      )
      .all();
    return { stats: getQueueStats(), items };
  });

  app.post("/api/v1/sync/check-conflict", async (req, reply) => {
    const b = conflictSchema.parse(req.body);
    req.auditPath = b.path;
    const abs = await resolveInsideRoot(sanitizeRelative(b.path));
    const st = await safeStat(abs);
    if (!st || !st.isFile()) return reply.code(404).send({ error: "NOT_FOUND" });
    const nasChecksum = await sha256File(abs);
    if (nasChecksum === b.platformChecksumSha256) {
      return { conflict: false, checksumSha256: nasChecksum };
    }
    return {
      conflict: true,
      resolution: "SYNC_CONFLICT",
      synology: { checksumSha256: nasChecksum, size: st.size, modifiedAt: new Date(st.mtimeMs).toISOString() },
      platform: { checksumSha256: b.platformChecksumSha256 },
    };
  });
}
