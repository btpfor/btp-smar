import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { env, VERSION } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { hmacAuthentication } from "./middleware/authentication.js";
import { registerRateLimit } from "./middleware/rate-limit.js";
import { attachAudit, logResponse } from "./middleware/audit.js";
import { healthRoutes } from "./routes/health.routes.js";
import { storageRoutes } from "./routes/storage.routes.js";
import { folderRoutes } from "./routes/folders.routes.js";
import { fileRoutes } from "./routes/files.routes.js";
import { uploadRoutes } from "./routes/uploads.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { startWatcher } from "./services/sync.service.js";
import { startWebhookLoop } from "./services/webhook.service.js";
import { PathSecurityError } from "./utils/path-security.js";
import { ZodError } from "zod";

async function main() {
  const app = Fastify({
    logger,
    bodyLimit: env.MAX_FILE_SIZE,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  // Capture rawBody pour HMAC (uniquement pour JSON, pas multipart)
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = body;
      try {
        done(null, body.length ? JSON.parse(body.toString("utf8")) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(multipart, {
    limits: { fileSize: env.MAX_FILE_SIZE, files: 1 },
  });
  await registerRateLimit(app);

  app.addHook("onRequest", attachAudit);
  app.addHook("preHandler", hmacAuthentication);
  app.addHook("onResponse", logResponse);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof PathSecurityError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", details: err.flatten() });
    }
    const map: Record<string, number> = {
      FILE_CONFLICT: 409,
      FOLDER_CONFLICT: 409,
      NOT_FOUND: 404,
      INVALID_NAME: 400,
      FILE_TOO_LARGE: 413,
      INVALID_FILENAME: 400,
      MULTIPART_REQUIRED: 400,
    };
    const status = map[err.message] ?? err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "unhandled error");
    return reply.code(status).send({ error: err.message });
  });

  await app.register(healthRoutes);
  await app.register(storageRoutes);
  await app.register(folderRoutes);
  await app.register(fileRoutes);
  await app.register(uploadRoutes);
  await app.register(syncRoutes);

  startWatcher();
  startWebhookLoop();

  await app.listen({ host: "0.0.0.0", port: env.PORT });
  logger.info({ port: env.PORT, version: VERSION }, "GECO Synology Connector ready");
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
