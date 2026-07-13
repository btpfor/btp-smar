import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { db } from "../services/db.service.js";
import { logger } from "../utils/logger.js";

const insertNonce = db.prepare("INSERT INTO used_nonces (nonce, ts) VALUES (?, ?)");
const findNonce = db.prepare("SELECT nonce FROM used_nonces WHERE nonce = ?");

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function hmacAuthentication(req: FastifyRequest, reply: FastifyReply) {
  // Health endpoint reste public
  if (req.url.startsWith("/api/v1/health")) return;

  const connectorId = req.headers["x-geco-connector-id"];
  const timestamp = req.headers["x-geco-timestamp"];
  const nonce = req.headers["x-geco-nonce"];
  const signature = req.headers["x-geco-signature"];

  if (
    typeof connectorId !== "string" ||
    typeof timestamp !== "string" ||
    typeof nonce !== "string" ||
    typeof signature !== "string"
  ) {
    return reply.code(401).send({ error: "MISSING_AUTH_HEADERS" });
  }

  if (connectorId !== env.GECO_CONNECTOR_ID) {
    return reply.code(401).send({ error: "UNKNOWN_CONNECTOR_ID" });
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return reply.code(401).send({ error: "INVALID_TIMESTAMP" });
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > env.HMAC_TIMESTAMP_TOLERANCE) {
    return reply.code(401).send({ error: "TIMESTAMP_EXPIRED" });
  }

  if (nonce.length < 8 || nonce.length > 128) {
    return reply.code(401).send({ error: "INVALID_NONCE" });
  }
  if (findNonce.get(nonce)) {
    return reply.code(401).send({ error: "NONCE_ALREADY_USED" });
  }

  // Le corps brut (rawBody) doit être exposé par le hook onRequest
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");

  const canonical = [
    req.method.toUpperCase(),
    req.url.split("?")[0],
    timestamp,
    nonce,
    bodyHash,
  ].join("\n");

  const expected = createHmac("sha256", env.GECO_CONNECTOR_SECRET).update(canonical).digest("hex");

  if (!safeEqualHex(expected, signature)) {
    logger.warn({ url: req.url, connectorId }, "HMAC signature mismatch");
    return reply.code(401).send({ error: "INVALID_SIGNATURE" });
  }

  try {
    insertNonce.run(nonce, ts);
  } catch {
    return reply.code(401).send({ error: "NONCE_ALREADY_USED" });
  }
}
