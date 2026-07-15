/* eslint-disable no-console */
/**
 * Test réel de la connectivité Synology depuis ce PC Windows.
 * Exécute : résolution DNS, port 445, connexion SMB, lecture, écriture, suppression.
 */
import "dotenv/config";
import { lookup } from "node:dns/promises";
import { createConnection } from "node:net";
import { env } from "../config/env.js";
import * as smb from "../services/smb-storage.service.js";

function ok(msg: string) { console.log(`[OK] ${msg}`); }
function fail(msg: string, err?: unknown): never {
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  console.error(`[ERREUR] ${msg}${detail ? " — " + detail : ""}`);
  process.exit(1);
}

async function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const s = createConnection({ host, port });
    const t = setTimeout(() => { s.destroy(); reject(new Error(`timeout ${timeoutMs}ms`)); }, timeoutMs);
    s.once("connect", () => { clearTimeout(t); s.end(); resolve(); });
    s.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function main() {
  console.log(`→ Test Synology DS112 : ${env.SYNOLOGY_HOST} / partage \\\\${env.SYNOLOGY_HOST}\\${env.SYNOLOGY_SMB_SHARE}`);
  const userLabel = env.SYNOLOGY_SMB_USERNAME ?? "(via Windows Credential Manager)";
  console.log(`  Utilisateur SMB : ${userLabel} (mot de passe masqué)\n`);

  try {
    const addr = await lookup(env.SYNOLOGY_HOST);
    ok(`DNS résolu : ${env.SYNOLOGY_HOST} → ${addr.address}`);
  } catch (e) { fail(`Impossible de résoudre ${env.SYNOLOGY_HOST}`, e); }

  try {
    await tcpProbe(env.SYNOLOGY_HOST, 445);
    ok("Port SMB 445 accessible");
  } catch (e) { fail("Port SMB 445 inaccessible (pare-feu ? SMB désactivé sur le DS112 ?)", e); }

  try {
    const r = await smb.testConnection();
    if (!r.ok) throw new Error(r.message ?? "connexion refusée");
    ok(`Partage ${env.SYNOLOGY_SMB_SHARE} accessible`);
  } catch (e) { fail(`Partage ${env.SYNOLOGY_SMB_SHARE} inaccessible`, e); }

  const diagFolder = ".diagnostic";
  const fname = `${diagFolder}/test-windows-${Date.now()}.txt`;
  const payload = Buffer.from(`GECO test ${new Date().toISOString()}\n`);

  try {
    await smb.ensureFolder(diagFolder);
    await smb.listDir("");
    ok("Lecture autorisée (listing racine du partage)");
  } catch (e) { fail("Lecture refusée sur le partage", e); }

  try {
    await smb.writeFile(fname, payload);
    ok(`Écriture autorisée (${payload.length} octets → ${fname})`);
  } catch (e) { fail("Écriture refusée sur le partage", e); }

  try {
    const back = await smb.readFile(fname);
    if (!back.equals(payload)) throw new Error("contenu relu incohérent");
    ok("Relecture identique (checksum contenu OK)");
  } catch (e) { fail("Relecture échouée", e); }

  try {
    await smb.unlink(fname);
    ok("Suppression du fichier temporaire réussie");
  } catch (e) { fail("Suppression du fichier temporaire échouée", e); }

  console.log("\n✔ Synology DS112 opérationnel pour le GECO Synology Gateway.");
}

main().catch((e) => fail("Erreur inattendue", e));
