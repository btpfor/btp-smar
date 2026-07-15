/**
 * Façade historique conservée pour la compatibilité des appels
 * `smb.testConnection()`, `smb.readFile()`, etc. utilisés dans
 * `job.service.ts`, `heartbeat.service.ts` et les scripts de test.
 *
 * L'implémentation réelle utilise désormais le client SMB natif
 * de Windows (voir `windows-smb.service.ts`). Les paquets npm
 * `smb2` / `ntlm` ont été supprimés — ils appelaient des primitives
 * crypto héritées (`DES-ECB`, `RC4`) désactivées par défaut dans
 * OpenSSL 3 / Node.js 22 et provoquaient `ERR_OSSL_EVP_UNSUPPORTED`.
 */
import { getStorageAdapter } from "./windows-smb.service.js";

const adapter = getStorageAdapter();

export async function testConnection(): Promise<{ ok: boolean; message?: string }> {
  const h = await adapter.healthCheck();
  if (h.nasAccessible && h.smbConnected && h.readAllowed) {
    return { ok: true };
  }
  return { ok: false, message: h.message ?? "SMB non disponible" };
}

export async function listDir(rel: string): Promise<string[]> {
  return adapter.list(rel);
}

export async function ensureFolder(rel: string): Promise<void> {
  return adapter.ensureFolder(rel);
}

export async function writeFile(rel: string, data: Buffer): Promise<void> {
  return adapter.write(rel, data);
}

export async function readFile(rel: string): Promise<Buffer> {
  return adapter.read(rel);
}

export async function rename(from: string, to: string): Promise<void> {
  return adapter.rename(from, to);
}

export async function unlink(rel: string): Promise<void> {
  return adapter.delete(rel);
}

export async function stat(rel: string) {
  return adapter.stat(rel);
}

export async function healthCheck() {
  return adapter.healthCheck();
}

export async function disconnect() {
  return adapter.disconnect();
}
