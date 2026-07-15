/**
 * WindowsSmbStorageAdapter — utilise le client SMB natif de Windows
 * (via `net use` pour l'authentification NTLM/SMB moderne) puis
 * accède au partage en UNC (`\\host\share\...`) avec `fs/promises`.
 *
 * Fonctionnalités :
 * - Reconnexion automatique lorsque la session UNC tombe (démontage,
 *   NAS redémarré, réseau coupé…).
 * - Backoff exponentiel avec jitter sur toutes les opérations SMB
 *   (voir `utils/retry.ts`).
 * - Récupération des identifiants depuis le Windows Credential Manager
 *   (cmdkey) si aucun `SYNOLOGY_SMB_USERNAME/PASSWORD` n'est fourni.
 *
 * Aucun paquet Node.js `smb2` / `ntlm` — ces derniers appellent des
 * primitives crypto héritées désactivées dans OpenSSL 3 (Node 22).
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import { joinInsideRoot, sanitizeRelative } from "../security/path-security.js";
import { readCredential } from "../security/credentials.js";
import { logger } from "../utils/logger.js";
import { isTransientError, retryWithBackoff } from "../utils/retry.js";
import type {
  DiskSpace,
  StorageAdapter,
  StorageHealth,
  StorageStat,
} from "./storage-adapter.interface.js";

const UNC_ROOT = `\\\\${env.SYNOLOGY_HOST}\\${env.SYNOLOGY_SMB_SHARE}`;

function absUnc(rel: string): string {
  const inside = joinInsideRoot(env.GECO_STORAGE_ROOT, rel).replaceAll("/", "\\");
  return inside ? `${UNC_ROOT}\\${inside}` : UNC_ROOT;
}

function scrub(text: string): string {
  const pw = env.SYNOLOGY_SMB_PASSWORD;
  if (!pw) return text;
  return text.split(pw).join("***");
}

function runNet(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("net", args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? -1, stdout, stderr }),
    );
  });
}

let mounted = false;
let mountInFlight: Promise<void> | null = null;
type CredentialSource = "env" | "credential-manager" | "windows-session";
let credentialSource: CredentialSource = "windows-session";

interface ResolvedCredentials {
  user?: string;
  password?: string;
  source: CredentialSource;
}

async function resolveCredentials(): Promise<ResolvedCredentials> {
  if (env.SYNOLOGY_SMB_USERNAME && env.SYNOLOGY_SMB_PASSWORD) {
    return {
      user: env.SYNOLOGY_SMB_USERNAME,
      password: env.SYNOLOGY_SMB_PASSWORD,
      source: "env",
    };
  }
  // Cherche une entrée dans le Windows Credential Manager pour cet hôte.
  try {
    const info = await readCredential(env.SYNOLOGY_HOST);
    if (info.present) {
      return { user: info.user, source: "credential-manager" };
    }
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "windows-smb: lecture Credential Manager impossible",
    );
  }
  // Dernier recours : session Windows courante.
  return { source: "windows-session" };
}

async function doMount(): Promise<void> {
  // Nettoie une éventuelle session obsolète sans casser si absente.
  await runNet(["use", UNC_ROOT, "/delete", "/y"]).catch(() => {});

  const creds = await resolveCredentials();
  credentialSource = creds.source;

  const args: string[] = ["use", UNC_ROOT];
  let userForLog = "(session Windows courante)";

  if (creds.source === "env" && creds.user && creds.password) {
    const fullUser =
      env.SYNOLOGY_SMB_DOMAIN && env.SYNOLOGY_SMB_DOMAIN.toUpperCase() !== "WORKGROUP"
        ? `${env.SYNOLOGY_SMB_DOMAIN}\\${creds.user}`
        : creds.user;
    args.push(creds.password, `/user:${fullUser}`);
    userForLog = fullUser;
  } else if (creds.source === "credential-manager") {
    userForLog = `${creds.user ?? "?"} (Windows Credential Manager)`;
  }
  args.push("/persistent:no");

  const res = await runNet(args);
  if (res.code !== 0) {
    const raw = (res.stderr || res.stdout || "").trim();
    const msg = scrub(raw) || `net use exited with code ${res.code}`;
    throw new Error(
      `Windows SMB mount failed for ${UNC_ROOT} as ${userForLog}: ${msg}`,
    );
  }
  mounted = true;
  logger.info(
    { share: UNC_ROOT, user: userForLog, source: credentialSource },
    "windows-smb: partage monté",
  );
}

async function mountShare(): Promise<void> {
  // Un seul mount à la fois — sinon les retries parallèles se marchent dessus.
  if (mountInFlight) return mountInFlight;
  mountInFlight = retryWithBackoff(doMount, {
    label: "net use mount",
    retries: env.SMB_RECONNECT_MAX_RETRIES,
    minDelayMs: env.SMB_RECONNECT_MIN_DELAY_MS,
    maxDelayMs: env.SMB_RECONNECT_MAX_DELAY_MS,
  })
    .catch((err) => {
      mounted = false;
      throw err;
    })
    .finally(() => {
      mountInFlight = null;
    });
  return mountInFlight;
}

async function ensureMounted(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(
      "WindowsSmbStorageAdapter n'est utilisable que sous Windows (win32).",
    );
  }
  if (!mounted) await mountShare();
}

/**
 * Exécute une opération SMB. En cas d'erreur transitoire (session UNC
 * tombée, timeout réseau…), démonte et retente avec backoff.
 */
async function withSession<T>(label: string, fn: () => Promise<T>): Promise<T> {
  await ensureMounted();
  return retryWithBackoff(
    async () => {
      try {
        return await fn();
      } catch (err) {
        if (isTransientError(err)) {
          // Force un remount avant le prochain essai.
          mounted = false;
          await runNet(["use", UNC_ROOT, "/delete", "/y"]).catch(() => {});
          await mountShare();
        }
        throw err;
      }
    },
    {
      label,
      retries: env.SMB_RECONNECT_MAX_RETRIES,
      minDelayMs: env.SMB_RECONNECT_MIN_DELAY_MS,
      maxDelayMs: env.SMB_RECONNECT_MAX_DELAY_MS,
    },
  );
}

export class WindowsSmbStorageAdapter implements StorageAdapter {
  async connect() {
    await ensureMounted();
  }

  async disconnect() {
    if (process.platform !== "win32") return;
    await runNet(["use", UNC_ROOT, "/delete", "/y"]).catch(() => {});
    mounted = false;
  }

  async healthCheck(): Promise<StorageHealth> {
    try {
      await ensureMounted();
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e));
      return {
        nasAccessible: false,
        smbConnected: false,
          shareAccessible: false,
        readAllowed: false,
        writeAllowed: false,
        message: msg,
      };
    }
    let shareAccessible = false;
    let readAllowed = false;
    let writeAllowed = false;
    let message: string | undefined;
    try {
      await fs.readdir(absUnc(""));
      shareAccessible = true;
      readAllowed = true;
    } catch (e) {
      message = scrub(e instanceof Error ? e.message : String(e));
    }
    if (readAllowed) {
      const probe = `.diagnostic/.geco-health-${Date.now()}.tmp`;
      try {
        await fs.mkdir(absUnc(".diagnostic"), { recursive: true });
        await fs.writeFile(absUnc(probe), Buffer.from("geco"));
        await fs.unlink(absUnc(probe));
        writeAllowed = true;
      } catch (e) {
        message = scrub(e instanceof Error ? e.message : String(e));
      }
    }
    return {
      nasAccessible: true,
      smbConnected: true,
      shareAccessible,
      readAllowed,
      writeAllowed,
      message,
    };
  }

  async list(rel: string) {
    return withSession("smb.list", () => fs.readdir(absUnc(rel)));
  }

  async read(rel: string) {
    return withSession("smb.read", () => fs.readFile(absUnc(rel)));
  }

  async write(rel: string, data: Buffer) {
    return withSession("smb.write", async () => {
      const safe = sanitizeRelative(rel);
      const parent = safe.split("/").slice(0, -1).join("/");
      if (parent) await fs.mkdir(absUnc(parent), { recursive: true });
      await fs.writeFile(absUnc(rel), data);
    });
  }

  async rename(from: string, to: string) {
    return withSession("smb.rename", () => fs.rename(absUnc(from), absUnc(to)));
  }

  async move(from: string, to: string) {
    return withSession("smb.move", async () => {
      const safe = sanitizeRelative(to);
      const parent = safe.split("/").slice(0, -1).join("/");
      if (parent) await fs.mkdir(absUnc(parent), { recursive: true });
      await fs.rename(absUnc(from), absUnc(to));
    });
  }

  async delete(rel: string) {
    return withSession("smb.delete", () => fs.unlink(absUnc(rel)));
  }

  async stat(rel): Promise<StorageStat | null> {
    return withSession("smb.stat", async () => {
      try {
        const s = await fs.stat(absUnc(rel));
        return { size: s.size, mtime: s.mtime, isDirectory: s.isDirectory() };
      } catch {
        return null;
      }
    });
  }

  async ensureFolder(rel: string) {
    return withSession("smb.ensureFolder", async () => {
      await fs.mkdir(absUnc(rel), { recursive: true });
    });
  }

  async getDiskSpace(): Promise<DiskSpace> {
    // fs.statfs ne supporte pas les chemins UNC de manière fiable sur Windows.
    return { totalBytes: null, usedBytes: null, availableBytes: null };
  }
}

export const windowsSmbAdapter: StorageAdapter = new WindowsSmbStorageAdapter();

export function getStorageAdapter(): StorageAdapter {
  if (process.platform !== "win32") {
    throw new Error(
      "Ce build du GECO Synology Gateway cible Windows. Aucune autre plateforme n'est supportée pour l'instant.",
    );
  }
  return windowsSmbAdapter;
}

/** Exposé pour les scripts de diagnostic. */
export function getCredentialSource(): CredentialSource {
  return credentialSource;
}
