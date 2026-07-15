/**
 * WindowsSmbStorageAdapter — utilise le client SMB natif de Windows
 * (via `net use` pour l'authentification NTLM/SMB moderne) puis
 * accède au partage en UNC (`\\host\share\...`) avec `fs/promises`.
 *
 * Cette approche évite entièrement les paquets Node.js `smb2` / `ntlm`
 * qui appellent des primitives crypto héritées (`DES-ECB`, `RC4`) désactivées
 * par défaut dans OpenSSL 3 / Node.js 22 (erreur ERR_OSSL_EVP_UNSUPPORTED).
 *
 * Fonctionne sur Windows 10 / 11 avec Node.js 22 LTS, sans
 * `--openssl-legacy-provider`.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import { joinInsideRoot, sanitizeRelative } from "../security/path-security.js";
import { logger } from "../utils/logger.js";
import type {
  DiskSpace,
  StorageAdapter,
  StorageHealth,
  StorageStat,
} from "./storage-adapter.js";

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
    const child = spawn("net", args, { windowsHide: true });
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

async function mountShare(): Promise<void> {
  // Nettoie une éventuelle session obsolète sans casser si absente.
  await runNet(["use", UNC_ROOT, "/delete", "/y"]).catch(() => {});
  const user =
    env.SYNOLOGY_SMB_DOMAIN && env.SYNOLOGY_SMB_DOMAIN.toUpperCase() !== "WORKGROUP"
      ? `${env.SYNOLOGY_SMB_DOMAIN}\\${env.SYNOLOGY_SMB_USERNAME}`
      : env.SYNOLOGY_SMB_USERNAME;

  // `net use \\host\share <password> /user:<user> /persistent:no`
  // Le mot de passe est passé en argument mais jamais loggué : on scrubbe
  // toutes les sorties avant journalisation.
  const res = await runNet([
    "use",
    UNC_ROOT,
    env.SYNOLOGY_SMB_PASSWORD,
    `/user:${user}`,
    "/persistent:no",
  ]);
  if (res.code !== 0) {
    const raw = (res.stderr || res.stdout || "").trim();
    const msg = scrub(raw) || `net use exited with code ${res.code}`;
    throw new Error(
      `Windows SMB mount failed for ${UNC_ROOT} as ${user}: ${msg}`,
    );
  }
  mounted = true;
  logger.info({ share: UNC_ROOT, user }, "windows-smb: partage monté");
}

async function ensureMounted(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(
      "WindowsSmbStorageAdapter n'est utilisable que sous Windows (win32).",
    );
  }
  if (!mounted) await mountShare();
}

export const windowsSmbAdapter: StorageAdapter = {
  async connect() {
    await ensureMounted();
  },

  async disconnect() {
    if (process.platform !== "win32") return;
    await runNet(["use", UNC_ROOT, "/delete", "/y"]).catch(() => {});
    mounted = false;
  },

  async healthCheck(): Promise<StorageHealth> {
    try {
      await ensureMounted();
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e));
      return {
        nasAccessible: false,
        smbConnected: false,
        readAllowed: false,
        writeAllowed: false,
        message: msg,
      };
    }
    let readAllowed = false;
    let writeAllowed = false;
    let message: string | undefined;
    try {
      await fs.readdir(absUnc(""));
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
      readAllowed,
      writeAllowed,
      message,
    };
  },

  async list(rel) {
    await ensureMounted();
    return fs.readdir(absUnc(rel));
  },

  async read(rel) {
    await ensureMounted();
    return fs.readFile(absUnc(rel));
  },

  async write(rel, data) {
    await ensureMounted();
    const safe = sanitizeRelative(rel);
    const parent = safe.split("/").slice(0, -1).join("/");
    if (parent) await fs.mkdir(absUnc(parent), { recursive: true });
    await fs.writeFile(absUnc(rel), data);
  },

  async rename(from, to) {
    await ensureMounted();
    await fs.rename(absUnc(from), absUnc(to));
  },

  async move(from, to) {
    await ensureMounted();
    const safe = sanitizeRelative(to);
    const parent = safe.split("/").slice(0, -1).join("/");
    if (parent) await fs.mkdir(absUnc(parent), { recursive: true });
    await fs.rename(absUnc(from), absUnc(to));
  },

  async delete(rel) {
    await ensureMounted();
    await fs.unlink(absUnc(rel));
  },

  async stat(rel): Promise<StorageStat | null> {
    await ensureMounted();
    try {
      const s = await fs.stat(absUnc(rel));
      return { size: s.size, mtime: s.mtime, isDirectory: s.isDirectory() };
    } catch {
      return null;
    }
  },

  async ensureFolder(rel) {
    await ensureMounted();
    await fs.mkdir(absUnc(rel), { recursive: true });
  },

  async getDiskSpace(): Promise<DiskSpace> {
    // fs.statfs est disponible sur Node 18.15+ mais ne supporte pas
    // les chemins UNC de manière fiable sur Windows : on renvoie null
    // plutôt que de mentir. Le heartbeat gère null explicitement.
    return { totalBytes: null, usedBytes: null, availableBytes: null };
  },
};

export function getStorageAdapter(): StorageAdapter {
  if (process.platform !== "win32") {
    throw new Error(
      "Ce build du GECO Synology Gateway cible Windows. Aucune autre plateforme n'est supportée pour l'instant.",
    );
  }
  return windowsSmbAdapter;
}
