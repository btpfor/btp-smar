/* eslint-disable no-console */
/**
 * `npm run doctor` — vérifie l'environnement Windows du GECO Synology Gateway
 * avant tout test réseau. Aucune connexion sortante n'est effectuée ici.
 */
import "dotenv/config";
import { platform, release, arch } from "node:os";
import { env, VERSION } from "../config/env.js";

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

console.log(`GECO Synology Gateway v${VERSION} — doctor`);
console.log("");
line("Node.js", process.version);
line("Platform", `${platform()} ${release()} (${arch()})`);
line("OpenSSL", process.versions.openssl ?? "?");

if (process.platform !== "win32") {
  console.error("\n[ERREUR] Ce Gateway est prévu pour Windows (win32).");
  process.exit(1);
}

console.log("\nConfiguration détectée :");
line("GECO_GATEWAY_ID", env.GECO_GATEWAY_ID);
line("GECO_GATEWAY_SECRET", `(${env.GECO_GATEWAY_SECRET.length} caractères)`);
line("GECO_API_URL", env.GECO_API_URL);
line("SYNOLOGY_HOST", env.SYNOLOGY_HOST);
line("SYNOLOGY_SMB_SHARE", env.SYNOLOGY_SMB_SHARE);
line("SYNOLOGY_SMB_DOMAIN", env.SYNOLOGY_SMB_DOMAIN);
line("SYNOLOGY_SMB_USERNAME", env.SYNOLOGY_SMB_USERNAME);
line("SYNOLOGY_SMB_PASSWORD", "(masqué)");

console.log("\n✔ Environnement valide. Lancer maintenant :");
console.log("    npm run test:synology");
console.log("    npm run test:gateway");
