/* eslint-disable no-console */
/**
 * Test réel de la communication HMAC avec l'API GECO (Cloudflare Worker).
 * N'affiche JAMAIS le secret ; ne loggue que sa longueur.
 */
import "dotenv/config";
import { request } from "undici";
import { env, VERSION } from "../config/env.js";
import { signOutgoing } from "../security/hmac.js";

function ok(msg: string) { console.log(`[OK] ${msg}`); }
function fail(msg: string, err?: unknown): never {
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  console.error(`[ERREUR] ${msg}${detail ? " — " + detail : ""}`);
  process.exit(1);
}

async function main() {
  console.log(`→ Test API GECO : ${env.GECO_API_URL}`);
  console.log(`  Gateway ID     : ${env.GECO_GATEWAY_ID}`);
  console.log(`  Secret         : (masqué, ${env.GECO_GATEWAY_SECRET.length} caractères)\n`);

  // 1. Joignabilité de l'origine
  try {
    const url = new URL(env.GECO_API_URL);
    const r = await request(url);
    void r.body.dump();
    ok(`API GECO accessible (HTTP ${r.statusCode} sur ${url.origin})`);
  } catch (e) { fail("API GECO inaccessible", e); }

  // 2. Envoi d'un heartbeat signé HMAC
  const path = "/api/public/gateway/heartbeat";
  const body = JSON.stringify({
    gatewayVersion: VERSION,
    nasHost: env.SYNOLOGY_HOST,
    nasReachable: false,
    smbConnected: false,
    pendingJobs: 0,
    failedJobs: 0,
    lastError: "[test:gateway] heartbeat de test — pas d'accès SMB vérifié ici",
  });
  const headers = signOutgoing("POST", path, body);
  const url = new URL(path, env.GECO_API_URL);

  let res;
  try {
    res = await request(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
  } catch (e) { fail("Requête heartbeat échouée (réseau)", e); }

  const text = await res.body.text();

  if (res.statusCode === 401 || res.statusCode === 403) {
    let err = "";
    try { err = (JSON.parse(text) as { error?: string }).error ?? text; } catch { err = text; }
    if (/INVALID_GATEWAY_ID|UNKNOWN_GATEWAY_ID/i.test(err)) fail(`Gateway ID rejeté : ${err} (vérifiez GECO_GATEWAY_ID côté plateforme)`);
    if (/INVALID_SIGNATURE/i.test(err)) fail(`Signature HMAC rejetée : ${err} (le GECO_GATEWAY_SECRET local ne correspond pas au secret configuré côté plateforme)`);
    if (/TIMESTAMP_EXPIRED/i.test(err)) fail(`Horodatage rejeté : ${err} (l'horloge de ce PC dérive de plus de 5 minutes)`);
    fail(`Heartbeat rejeté (HTTP ${res.statusCode}) : ${err}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    fail(`Heartbeat rejeté (HTTP ${res.statusCode}) : ${text}`);
  }

  ok("Gateway ID accepté");
  ok("Signature HMAC acceptée");
  ok(`Heartbeat envoyé (HTTP ${res.statusCode})`);
  console.log("\n✔ Le Gateway est correctement appairé avec la plateforme GECO.");
  console.log("  L'interface Administration → Stockage & Synology doit passer à « En ligne » sous 30–60 s.");
}

main().catch((e) => fail("Erreur inattendue", e));
