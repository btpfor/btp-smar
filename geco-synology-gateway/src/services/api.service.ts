import { request } from "undici";
import { env } from "../config/env.js";
import { signOutgoing, type SignedHeaders } from "../security/hmac.js";
import { logger } from "../utils/logger.js";
import { retryWithBackoff } from "../utils/retry.js";

export interface Job {
  id: string;
  operation: string;
  source_path: string | null;
  destination_path: string | null;
  file_id: string | null;
  project_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly bodyText: string,
  ) {
    super(`API ${path} → ${status} ${bodyText}`);
  }
}

function toHttpHeaders(signed: SignedHeaders, hasJsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "x-geco-gateway-id": signed["x-geco-gateway-id"],
    "x-geco-timestamp": signed["x-geco-timestamp"],
    "x-geco-nonce": signed["x-geco-nonce"],
    "x-geco-signature": signed["x-geco-signature"],
    accept: "application/json",
  };
  if (hasJsonBody) headers["content-type"] = "application/json";
  return headers;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const payload = body ? JSON.stringify(body) : "";
  const headers = toHttpHeaders(signOutgoing(method, path, payload), payload.length > 0);
  const url = new URL(path, env.GECO_API_URL);
  const res = await request(url, {
    method,
    headers,
    body: payload || undefined,
  });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new HttpError(res.statusCode, `${method} ${path}`, text);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function fetchPendingJobs(): Promise<Job[]> {
  const res = await call<{ jobs: Job[] }>("GET", "/api/public/gateway/jobs");
  return res.jobs ?? [];
}

export async function startJob(id: string): Promise<void> {
  await call("POST", `/api/public/gateway/jobs/${id}/start`, {});
}

export async function completeJob(id: string, result: Record<string, unknown>): Promise<void> {
  await call("POST", `/api/public/gateway/jobs/${id}/complete`, { result });
}

export async function failJob(id: string, error: string, status: "FAILED" | "CONFLICT" = "FAILED"): Promise<void> {
  await call("POST", `/api/public/gateway/jobs/${id}/fail`, { error, status });
}

/**
 * Heartbeat avec retry/backoff pour les erreurs réseau ou HTTP 5xx.
 * Les erreurs 4xx (auth invalide, payload invalide…) ne sont PAS retentées :
 * elles indiquent un problème de configuration côté gateway.
 */
export async function sendHeartbeat(payload: Record<string, unknown>): Promise<void> {
  await retryWithBackoff(
    () => call("POST", "/api/public/gateway/heartbeat", payload),
    {
      retries: 4,
      minDelayMs: 1000,
      maxDelayMs: 20_000,
      label: "heartbeat",
      shouldRetry: (err) => {
        if (err instanceof HttpError) return err.status >= 500 && err.status < 600;
        const anyErr = err as { code?: string; message?: string };
        if (anyErr.code) {
          return [
            "ECONNRESET",
            "ECONNREFUSED",
            "ENOTFOUND",
            "EAI_AGAIN",
            "ETIMEDOUT",
            "UND_ERR_CONNECT_TIMEOUT",
            "UND_ERR_SOCKET",
            "UND_ERR_HEADERS_TIMEOUT",
            "UND_ERR_BODY_TIMEOUT",
          ].includes(anyErr.code);
        }
        const msg = (anyErr.message ?? "").toLowerCase();
        return msg.includes("timeout") || msg.includes("network") || msg.includes("fetch failed");
      },
    },
  ).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "heartbeat failed after retries");
    throw err;
  });
}
