/* eslint-disable no-console */
/**
 * CLI de gestion des identifiants SMB dans le Windows Credential Manager.
 *
 * Usage :
 *   npm run credentials -- status
 *   npm run credentials -- set        (utilise SYNOLOGY_SMB_USERNAME/PASSWORD depuis .env)
 *   npm run credentials -- set <user> <password>
 *   npm run credentials -- delete
 *
 * Une fois l'identifiant stocké dans le coffre Windows, vous pouvez
 * SUPPRIMER SYNOLOGY_SMB_USERNAME et SYNOLOGY_SMB_PASSWORD du fichier .env :
 * le Gateway les récupèrera automatiquement à chaque montage UNC.
 */
import "dotenv/config";
import { env } from "../config/env.js";
import {
  deleteCredential,
  readCredential,
  upsertCredential,
} from "../security/credentials.js";

async function main() {
  if (process.platform !== "win32") {
    console.error("[ERREUR] Cette commande n'est utilisable que sous Windows.");
    process.exit(1);
  }

  const [cmd, arg1, arg2] = process.argv.slice(2);
  const target = env.SYNOLOGY_HOST;

  switch (cmd) {
    case "status": {
      const info = await readCredential(target);
      if (!info.present) {
        console.log(`ℹ Aucune entrée cmdkey pour ${target}.`);
        process.exit(1);
      }
      console.log(`✔ Entrée cmdkey présente pour ${target} — utilisateur : ${info.user ?? "(inconnu)"}`);
      break;
    }
    case "set": {
      const user = arg1 || env.SYNOLOGY_SMB_USERNAME;
      const password = arg2 || env.SYNOLOGY_SMB_PASSWORD;
      if (!user || !password) {
        console.error(
          "[ERREUR] Ni argument fourni ni SYNOLOGY_SMB_USERNAME/PASSWORD présents dans .env.",
        );
        console.error("Usage: npm run credentials -- set <user> <password>");
        process.exit(1);
      }
      await upsertCredential(target, user, password);
      console.log(`✔ Identifiant SMB stocké dans Windows Credential Manager pour ${target} (utilisateur ${user}).`);
      console.log("  Vous pouvez maintenant retirer SYNOLOGY_SMB_USERNAME / SYNOLOGY_SMB_PASSWORD de .env.");
      break;
    }
    case "delete": {
      const removed = await deleteCredential(target);
      console.log(
        removed
          ? `✔ Entrée cmdkey supprimée pour ${target}.`
          : `ℹ Aucune entrée à supprimer pour ${target}.`,
      );
      break;
    }
    default:
      console.log("Commandes disponibles : status | set [user] [password] | delete");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("[ERREUR]", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
