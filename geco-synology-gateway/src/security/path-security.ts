import { posix } from "node:path";

/**
 * Normalise et valide un chemin relatif au partage SMB `GECO`.
 * Refuse : chemins absolus, backslashes ambigus, segments `..`, caractères de contrôle.
 * Retourne un chemin POSIX-relatif sûr (ex: `PROJETS/ABC/01_ADMINISTRATION/note.pdf`).
 */
export function sanitizeRelative(input: string): string {
  if (typeof input !== "string") throw new Error("PATH_INVALID");
  const raw = input.replace(/\\/g, "/").trim();
  if (raw === "" || raw === "." || raw === "/") return "";
  if (raw.startsWith("/")) throw new Error("PATH_ABSOLUTE_FORBIDDEN");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(raw)) throw new Error("PATH_CONTROL_CHAR");
  const normalized = posix.normalize(raw);
  if (normalized.startsWith("..") || normalized.split("/").includes("..")) {
    throw new Error("PATH_TRAVERSAL_FORBIDDEN");
  }
  // Refus des noms réservés Windows au niveau segment
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  for (const seg of normalized.split("/")) {
    if (reserved.test(seg)) throw new Error("PATH_RESERVED_NAME");
  }
  return normalized;
}

export function joinInsideRoot(root: string, rel: string): string {
  const safe = sanitizeRelative(rel);
  const base = root.replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${safe}` : safe;
}
