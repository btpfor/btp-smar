import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export interface SignedHeaders {
  "x-geco-gateway-id": string;
  "x-geco-timestamp": string;
  "x-geco-nonce": string;
  "x-geco-signature": string;
}

/**
 * Signe une requête sortante vers la plateforme GECO.
 * Le canonique inclut méthode, chemin (sans query), timestamp, nonce, sha256(body).
 */
export function signOutgoing(method: string, path: string, body: string): SignedHeaders {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", env.GECO_GATEWAY_SECRET).update(canonical).digest("hex");
  return {
    "x-geco-gateway-id": env.GECO_GATEWAY_ID,
    "x-geco-timestamp": ts,
    "x-geco-nonce": nonce,
    "x-geco-signature": signature,
  };
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
