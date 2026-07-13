import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../services/db.service.js";
import { logger } from "../utils/logger.js";

const insertLog = db.prepare(
  "INSERT INTO connector_logs (request_id, action, relative_path, result, duration_ms, ts) VALUES (?, ?, ?, ?, ?, ?)",
);

declare module "fastify" {
  interface FastifyRequest {
    startedAt?: number;
    auditPath?: string;
  }
}

export function attachAudit(req: FastifyRequest, _reply: FastifyReply, done: () => void) {
  req.startedAt = Date.now();
  done();
}

export function logResponse(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const duration = req.startedAt ? Date.now() - req.startedAt : 0;
  const result = reply.statusCode < 400 ? "ok" : "error";
  const action = `${req.method} ${req.url.split("?")[0]}`;
  try {
    insertLog.run(
      req.id ?? null,
      action,
      req.auditPath ?? null,
      result,
      duration,
      Math.floor(Date.now() / 1000),
    );
  } catch (err) {
    logger.error({ err }, "audit log insert failed");
  }
  done();
}
