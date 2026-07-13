import { createServerFn } from "@tanstack/react-start";
import { createHash, createHmac, randomUUID } from "node:crypto";

function buildHeaders(method: string, path: string, body: string) {
  const id = process.env.SYNOLOGY_CONNECTOR_ID;
  const secret = process.env.SYNOLOGY_CONNECTOR_SECRET;
  if (!id || !secret) throw new Error("CONNECTOR_NOT_CONFIGURED");
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    "content-type": "application/json",
    "x-geco-connector-id": id,
    "x-geco-timestamp": ts,
    "x-geco-nonce": nonce,
    "x-geco-signature": signature,
  };
}

export const getSynologyStatus = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.SYNOLOGY_CONNECTOR_URL;
  const configured = Boolean(
    url && process.env.SYNOLOGY_CONNECTOR_ID && process.env.SYNOLOGY_CONNECTOR_SECRET,
  );
  if (!url || !configured) {
    return { configured: false, online: false, message: "GECO Synology Connector hors ligne" };
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const healthRes = await fetch(new URL("/api/v1/health", url), { signal: controller.signal });
    clearTimeout(t);
    if (!healthRes.ok) {
      return { configured: true, online: false, message: `HTTP ${healthRes.status}` };
    }
    const health = (await healthRes.json()) as Record<string, unknown>;

    // Storage status is signed
    let storage: Record<string, unknown> | null = null;
    try {
      const path = "/api/v1/storage/status";
      const headers = buildHeaders("GET", path, "");
      const sres = await fetch(new URL(path, url), { headers });
      if (sres.ok) storage = (await sres.json()) as Record<string, unknown>;
    } catch { /* ignore */ }

    return {
      configured: true,
      online: true,
      health,
      storage,
      lastCheckedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      configured: true,
      online: false,
      message: err instanceof Error ? err.message : "unreachable",
    };
  }
});
