import { realpath, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, normalize, sep, join, dirname } from "node:path";
import { env } from "../config/env.js";

export class PathSecurityError extends Error {
  code = "PATH_FORBIDDEN";
  status = 403;
}

const FORBIDDEN_SEGMENTS = ["..", "\0"];

/**
 * Nettoie un chemin relatif fourni par l'API.
 * - Refuse les octets NULL, les segments ".."
 * - Refuse les chemins absolus
 */
export function sanitizeRelative(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new PathSecurityError("Chemin vide");
  }
  if (input.includes("\0")) throw new PathSecurityError("Caractère interdit");
  if (input.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(input)) {
    throw new PathSecurityError("Chemin absolu interdit");
  }
  const normalized = normalize(input).replace(/^([./\\])+/, "");
  for (const seg of normalized.split(/[\\/]/)) {
    if (FORBIDDEN_SEGMENTS.includes(seg)) {
      throw new PathSecurityError("Segment interdit");
    }
  }
  return normalized;
}

/**
 * Résout un chemin relatif à l'intérieur de GECO_STORAGE_ROOT.
 * Empêche le path traversal et les liens symboliques sortant du root.
 */
export async function resolveInsideRoot(rel: string): Promise<string> {
  const safeRel = sanitizeRelative(rel);
  const rootReal = await realpath(env.GECO_STORAGE_ROOT).catch(() => resolve(env.GECO_STORAGE_ROOT));
  const candidate = resolve(rootReal, safeRel);

  // Vérification par préfixe (avant realpath, en cas de fichier inexistant)
  const rootWithSep = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  if (candidate !== rootReal && !candidate.startsWith(rootWithSep)) {
    throw new PathSecurityError("Chemin hors du dossier racine GECO");
  }

  // Si le fichier existe, résoudre les symlinks et re-vérifier
  if (existsSync(candidate)) {
    const real = await realpath(candidate);
    if (real !== rootReal && !real.startsWith(rootWithSep)) {
      throw new PathSecurityError("Lien symbolique interdit");
    }
    return real;
  }

  // Vérifier le parent existant
  let parent = dirname(candidate);
  while (!existsSync(parent) && parent !== rootReal && parent.startsWith(rootWithSep)) {
    parent = dirname(parent);
  }
  if (existsSync(parent)) {
    const parentReal = await realpath(parent);
    if (parentReal !== rootReal && !parentReal.startsWith(rootWithSep)) {
      throw new PathSecurityError("Parent hors du dossier racine GECO");
    }
  }
  return candidate;
}

/** Convertit un chemin absolu interne en chemin relatif exposable. */
export function toRelative(absolute: string): string {
  const root = env.GECO_STORAGE_ROOT.endsWith(sep)
    ? env.GECO_STORAGE_ROOT
    : env.GECO_STORAGE_ROOT + sep;
  if (absolute === env.GECO_STORAGE_ROOT) return "";
  if (!absolute.startsWith(root)) return "";
  return absolute.slice(root.length).split(sep).join("/");
}

export async function ensureDir(abs: string): Promise<void> {
  await mkdir(abs, { recursive: true });
}

export async function safeStat(abs: string) {
  try {
    return await stat(abs);
  } catch {
    return null;
  }
}

export function trashRoot(): string {
  return join(env.GECO_STORAGE_ROOT, ".trash");
}

export function tempRoot(): string {
  return join(env.GECO_STORAGE_ROOT, ".temp");
}
