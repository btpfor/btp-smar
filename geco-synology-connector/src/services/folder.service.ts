import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveInsideRoot, safeStat, sanitizeRelative, toRelative } from "../utils/path-security.js";

export async function createFolder(relativePath: string, name: string) {
  const parentRel = sanitizeRelative(relativePath || ".");
  const targetRel = join(parentRel, sanitizeName(name));
  const abs = await resolveInsideRoot(targetRel);
  const existing = await safeStat(abs);
  if (existing?.isDirectory()) {
    return { created: false, relativePath: toRelative(abs) };
  }
  if (existing) throw new Error("FOLDER_CONFLICT");
  await mkdir(abs, { recursive: true });
  return { created: true, relativePath: toRelative(abs) };
}

const PROJECT_SUBFOLDERS = [
  "01_ADMINISTRATION",
  "02_CONTRATS",
  "03_ETUDES",
  "04_PLANS",
  "05_AUTOCAD",
  "06_BUDGET",
  "07_FACTURES",
  "08_RAPPORTS",
  "09_PHOTOS_CHANTIER",
  "10_VIDEOS",
  "11_REUNIONS",
  "12_HSE",
  "13_ARCHIVES",
];

export async function initializeProject(projectCode: string, projectName: string) {
  const safeCode = sanitizeName(projectCode);
  const safeName = sanitizeName(projectName).toUpperCase();
  const folderName = `${safeCode}-${safeName}`.slice(0, 120);
  const rootRel = join("PROJETS", folderName);
  const rootAbs = await resolveInsideRoot(rootRel);
  const existing = await safeStat(rootAbs);
  if (existing) {
    return { created: false, relativePath: toRelative(rootAbs), subfolders: [] };
  }
  await mkdir(rootAbs, { recursive: true });
  const created: string[] = [];
  for (const sub of PROJECT_SUBFOLDERS) {
    const abs = await resolveInsideRoot(join(rootRel, sub));
    await mkdir(abs, { recursive: true });
    created.push(toRelative(abs));
  }
  return { created: true, relativePath: toRelative(rootAbs), subfolders: created };
}

function sanitizeName(input: string): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("INVALID_NAME");
  return cleaned;
}
