import { env } from "../config/env.js";
import { joinInsideRoot, sanitizeRelative } from "../security/path-security.js";
import { logger } from "../utils/logger.js";

// smb2 n'expose pas de types officiels : on encapsule strictement l'API utilisée.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SMB2Client = any;
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
import SMB2 from "smb2";

function newClient(): SMB2Client {
  return new SMB2({
    share: `\\\\${env.SYNOLOGY_HOST}\\${env.SYNOLOGY_SMB_SHARE}`,
    domain: env.SYNOLOGY_SMB_DOMAIN,
    username: env.SYNOLOGY_SMB_USERNAME,
    password: env.SYNOLOGY_SMB_PASSWORD,
    autoCloseTimeout: 10_000,
  });
}

function p<T>(fn: (cb: (err: Error | null, res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
}

function abs(rel: string): string {
  return joinInsideRoot(env.GECO_STORAGE_ROOT, rel).replaceAll("/", "\\");
}

/** Vérifie l'accès au partage GECO et retourne des stats basiques. */
export async function testConnection(): Promise<{ ok: boolean; message?: string }> {
  const smb = newClient();
  try {
    await p<string[]>((cb) => smb.readdir(env.GECO_STORAGE_ROOT.replaceAll("/", "\\") || ".", cb));
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, "SMB test failed");
    return { ok: false, message: err instanceof Error ? err.message : "unknown" };
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function listDir(rel: string): Promise<string[]> {
  const smb = newClient();
  try {
    return await p<string[]>((cb) => smb.readdir(abs(rel), cb));
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function ensureFolder(rel: string): Promise<void> {
  const safe = sanitizeRelative(rel);
  const segments = safe.split("/").filter(Boolean);
  let current = "";
  const smb = newClient();
  try {
    for (const seg of segments) {
      current = current ? `${current}/${seg}` : seg;
      const path = abs(current);
      try {
        await p<void>((cb) => smb.mkdir(path, cb));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/exists|STATUS_OBJECT_NAME_COLLISION/i.test(msg)) throw err;
      }
    }
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function writeFile(rel: string, data: Buffer): Promise<void> {
  const smb = newClient();
  try {
    await p<void>((cb) => smb.writeFile(abs(rel), data, cb));
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function readFile(rel: string): Promise<Buffer> {
  const smb = newClient();
  try {
    return await p<Buffer>((cb) => smb.readFile(abs(rel), cb));
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function rename(from: string, to: string): Promise<void> {
  const smb = newClient();
  try {
    await p<void>((cb) => smb.rename(abs(from), abs(to), cb));
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function unlink(rel: string): Promise<void> {
  const smb = newClient();
  try {
    await p<void>((cb) => smb.unlink(abs(rel), cb));
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}

export async function stat(
  rel: string,
): Promise<{ size: number; mtime: Date; isDirectory: boolean } | null> {
  const smb = newClient();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await p<any>((cb) => smb.stat(abs(rel), cb));
    return {
      size: Number(s.size ?? 0),
      mtime: new Date(s.mtime ?? Date.now()),
      isDirectory: Boolean(s.isDirectory ? s.isDirectory() : false),
    };
  } catch {
    return null;
  } finally {
    try { smb.close(); } catch { /* noop */ }
  }
}
