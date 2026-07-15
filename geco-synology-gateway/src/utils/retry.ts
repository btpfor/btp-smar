/**
 * Exponential backoff retry helper for transient SMB / network errors.
 * Reused par windows-smb.service.ts pour la reconnexion automatique.
 */
import { logger } from "./logger.js";

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  label?: string;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void | Promise<void>;
  shouldRetry?: (err: unknown) => boolean;
}

const DEFAULTS: Required<Omit<RetryOptions, "label" | "onRetry" | "shouldRetry">> = {
  retries: 5,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: true,
};

/** Codes d'erreur Node/Windows considérés comme transitoires. */
const TRANSIENT_CODES = new Set([
  "ENOENT",       // partage démonté sous nos pieds
  "ENOTCONN",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EBUSY",
  "EPERM",        // parfois transitoire quand la session UNC vient d'expirer
  "EACCES",       // idem
  "UNKNOWN",
]);

export function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { code?: string; message?: string };
  if (anyErr.code && TRANSIENT_CODES.has(anyErr.code)) return true;
  const msg = (anyErr.message ?? "").toLowerCase();
  return (
    msg.includes("network name") ||           // "The specified network name is no longer available"
    msg.includes("net use") ||
    msg.includes("smb") ||
    msg.includes("session") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("reset")
  );
}

export function computeDelay(attempt: number, opts: Required<Omit<RetryOptions, "label" | "onRetry" | "shouldRetry">>): number {
  const base = Math.min(opts.maxDelayMs, opts.minDelayMs * Math.pow(opts.factor, attempt));
  if (!opts.jitter) return base;
  // Full jitter (AWS blog) — évite les tempêtes de reconnexion.
  return Math.floor(Math.random() * base);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  const should = options.shouldRetry ?? isTransientError;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries || !should(err)) throw err;
      const delay = computeDelay(attempt, opts);
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { label: options.label, attempt: attempt + 1, retries: opts.retries, delay, err: msg },
        "retry: transient failure, backing off",
      );
      if (options.onRetry) await options.onRetry(err, attempt + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
