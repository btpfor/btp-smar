/**
 * Windows Credential Manager wrapper (cmdkey).
 *
 * Permet de stocker les identifiants SMB du DS112 dans le coffre-fort
 * natif de Windows au lieu de les laisser en clair dans `.env`.
 *
 * Lorsqu'une entrée cmdkey existe pour l'hôte cible, `net use \\host\share`
 * se connecte automatiquement sans qu'aucun mot de passe ne transite par
 * Node.js. C'est le mécanisme recommandé en production.
 */
import { spawn } from "node:child_process";

export interface CredentialInfo {
  target: string;
  user?: string;
  present: boolean;
}

function run(
  cmd: string,
  args: string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (input) child.stdin.end(input);
  });
}

function ensureWindows() {
  if (process.platform !== "win32") {
    throw new Error("Windows Credential Manager n'est disponible que sur Windows.");
  }
}

/**
 * Ajoute (ou remplace) une entrée cmdkey pour l'hôte SMB.
 * Le mot de passe est passé en argument à cmdkey (comme pour `net use`) ;
 * il n'est jamais loggué et n'est jamais renvoyé par cette fonction.
 */
export async function upsertCredential(target: string, user: string, password: string): Promise<void> {
  ensureWindows();
  // cmdkey n'a pas de "update", il faut d'abord supprimer puis recréer
  // pour éviter les doublons masqués.
  await run("cmdkey", ["/delete", `:${target}`]).catch(() => {});
  const res = await run("cmdkey", [
    `/add:${target}`,
    `/user:${user}`,
    `/pass:${password}`,
  ]);
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || "").trim() || `cmdkey exited with code ${res.code}`;
    throw new Error(`cmdkey /add failed: ${msg}`);
  }
}

export async function deleteCredential(target: string): Promise<boolean> {
  ensureWindows();
  const res = await run("cmdkey", ["/delete", `:${target}`]);
  return res.code === 0;
}

/**
 * Vérifie la présence d'une entrée cmdkey pour l'hôte cible.
 * `cmdkey /list:target` renvoie le nom d'utilisateur associé — jamais le mot de passe.
 */
export async function readCredential(target: string): Promise<CredentialInfo> {
  ensureWindows();
  const res = await run("cmdkey", [`/list:${target}`]);
  const output = (res.stdout || "") + (res.stderr || "");
  if (res.code !== 0 || /NONE|aucun/i.test(output)) {
    return { target, present: false };
  }
  const m = output.match(/User(?:name)?\s*[:=]\s*(\S+)/i) ?? output.match(/Utilisateur\s*[:=]\s*(\S+)/i);
  return { target, present: true, user: m?.[1] };
}
