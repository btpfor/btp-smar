import { request } from "undici";
import { env } from "../config/env.js";
import { signOutgoing } from "../security/hmac.js";
import { logger } from "../utils/logger.js";

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

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const payload = body ? JSON.stringify(body) : "";
  const headers = signOutgoing(method, path, payload);
  const url = new URL(path, env.GECO_API_URL);
  const res = await request(url, {
    method,
    headers,
    body: payload || undefined,
  });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`API ${method} ${path} → ${res.statusCode} ${text}`);
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

export async function sendHeartbeat(payload: Record<string, unknown>): Promise<void> {
  try {
    await call("POST", "/api/public/gateway/heartbeat", payload);
  } catch (err) {
    logger.warn({ err }, "heartbeat failed");
  }
}
