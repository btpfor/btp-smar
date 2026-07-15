import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface AuthOk {
  ok: true;
  gatewayId: string;
  timestamp: string;
  nonce: string;
  signatureLength: number;
  rawBody: string;
}
export interface AuthFail {
  ok: false;
  status: number;
  error: string;
  step: string;
  gatewayId?: string | null;
  timestamp?: string | null;
  hasNonce?: boolean;
  signatureLength?: number;
}

interface GatewayConfig {
  gatewayId?: string;
  gatewaySecret?: string;
  source: "worker-env" | "process-env" | "missing";
}

type WorkerRuntimeGlobals = typeof globalThis & {
  __env__?: Record<string, unknown>;
};

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function jsonError(status: number, error: string, requestId?: string): Response {
  return jsonResponse(status, requestId ? { error, requestId } : { error });
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function readStringEnv(env: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = env?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readGatewayConfig(): GatewayConfig {
  const workerEnv = (globalThis as WorkerRuntimeGlobals).__env__;
  const workerGatewayId = readStringEnv(workerEnv, "GECO_GATEWAY_ID");
  const workerGatewaySecret = readStringEnv(workerEnv, "GECO_GATEWAY_SECRET");
  if (workerGatewayId || workerGatewaySecret) {
    return {
      gatewayId: workerGatewayId,
      gatewaySecret: workerGatewaySecret,
      source: "worker-env",
    };
  }

  return {
    gatewayId: process.env.GECO_GATEWAY_ID,
    gatewaySecret: process.env.GECO_GATEWAY_SECRET,
    source: process.env.GECO_GATEWAY_ID || process.env.GECO_GATEWAY_SECRET ? "process-env" : "missing",
  };
}

function logGatewayConfigCheck(config: GatewayConfig): void {
  console.warn({
    event: "GATEWAY_CONFIG_CHECK",
    gatewayIdConfigured: Boolean(config.gatewayId),
    gatewaySecretConfigured: Boolean(config.gatewaySecret),
    gatewaySecretLength: config.gatewaySecret?.length ?? 0,
  });
}

export async function verifyGatewayRequest(request: Request): Promise<AuthOk | AuthFail> {
  const config = readGatewayConfig();
  const expectedId = config.gatewayId;
  const secret = config.gatewaySecret;
  if (!expectedId || !secret) {
    logGatewayConfigCheck(config);
    return { ok: false, status: 503, error: "GATEWAY_NOT_CONFIGURED", step: "READ_GATEWAY_ENV" };
  }
  const id = request.headers.get("x-geco-gateway-id");
  const ts = request.headers.get("x-geco-timestamp");
  const nonce = request.headers.get("x-geco-nonce");
  const signature = request.headers.get("x-geco-signature");
  if (!id || !ts || !nonce || !signature) {
    return {
      ok: false,
      status: 401,
      error: "MISSING_AUTH_HEADERS",
      step: "READ_AUTH_HEADERS",
      gatewayId: id,
      timestamp: ts,
      hasNonce: Boolean(nonce),
      signatureLength: signature?.length ?? 0,
    };
  }
  if (id !== expectedId) {
    return {
      ok: false,
      status: 401,
      error: "INVALID_GATEWAY_ID",
      step: "VERIFY_GATEWAY_ID",
      gatewayId: id,
      timestamp: ts,
      hasNonce: true,
      signatureLength: signature.length,
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const t = Number.parseInt(ts, 10);
  if (!Number.isFinite(t) || Math.abs(now - t) > 300) {
    return {
      ok: false,
      status: 401,
      error: "TIMESTAMP_EXPIRED",
      step: "VERIFY_TIMESTAMP",
      gatewayId: id,
      timestamp: ts,
      hasNonce: true,
      signatureLength: signature.length,
    };
  }
  const url = new URL(request.url);
  const bodyText = request.method === "GET" ? "" : await request.clone().text();
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const canonical = [request.method.toUpperCase(), url.pathname, ts, nonce, bodyHash].join("\n");
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  if (!safeEqualHex(expected, signature)) {
    return {
      ok: false,
      status: 401,
      error: "INVALID_SIGNATURE",
      step: "VERIFY_HMAC_SIGNATURE",
      gatewayId: id,
      timestamp: ts,
      hasNonce: true,
      signatureLength: signature.length,
    };
  }
  return {
    ok: true,
    gatewayId: id,
    timestamp: ts,
    nonce,
    signatureLength: signature.length,
    rawBody: bodyText,
  };
}
