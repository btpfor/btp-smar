import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

const ROUTE = "/api/public/gateway/heartbeat";

function createRequestId(): string {
  return crypto.randomUUID();
}

function logHeartbeat(level: "info" | "warn" | "error", details: Record<string, unknown>) {
  const payload = {
    route: ROUTE,
    ...details,
  };
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const Route = createFileRoute("/api/public/gateway/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = createRequestId();
        let step = "START";
        let gatewayId: string | null = null;
        let timestamp: string | null = null;
        let hasNonce = false;
        let signatureLength = 0;

        try {
          step = "VERIFY_HMAC_REQUEST";
          const auth = await verifyGatewayRequest(request);
          if (!auth.ok) {
            if (auth.error !== "GATEWAY_NOT_CONFIGURED") {
              logHeartbeat("warn", {
                requestId,
                gatewayId: auth.gatewayId ?? null,
                timestamp: auth.timestamp ?? null,
                hasNonce: auth.hasNonce ?? false,
                signatureLength: auth.signatureLength ?? 0,
                step: auth.step,
                errorType: auth.error,
                message: auth.error,
              });
            }
            return jsonError(auth.status, auth.error, requestId);
          }

          gatewayId = auth.gatewayId;
          timestamp = auth.timestamp;
          hasNonce = Boolean(auth.nonce);
          signatureLength = auth.signatureLength;

          step = "PARSE_JSON_BODY";
          let body: Record<string, unknown>;
          try {
            body = auth.rawBody ? (JSON.parse(auth.rawBody) as Record<string, unknown>) : {};
          } catch {
            logHeartbeat("warn", {
              requestId,
              gatewayId,
              timestamp,
              hasNonce,
              signatureLength,
              step,
              errorType: "INVALID_JSON",
              message: "Invalid JSON payload",
            });
            return jsonError(400, "INVALID_JSON", requestId);
          }

          step = "LOAD_BACKEND_CLIENT";
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          step = "CHECK_REPLAY_NONCE";
          await supabaseAdmin
            .from("gateway_request_nonces")
            .delete()
            .lt("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
          const { error: nonceError } = await supabaseAdmin
            .from("gateway_request_nonces")
            .insert({ nonce: auth.nonce, gateway_id: gatewayId });
          if (nonceError) {
            const isDuplicate = nonceError.code === "23505" || /duplicate|unique/i.test(nonceError.message);
            logHeartbeat("warn", {
              requestId,
              gatewayId,
              timestamp,
              hasNonce,
              signatureLength,
              step,
              errorType: isDuplicate ? "NONCE_ALREADY_USED" : "NONCE_STORE_ERROR",
              message: isDuplicate ? "Nonce already used" : nonceError.message,
            });
            return jsonError(isDuplicate ? 409 : 500, isDuplicate ? "NONCE_ALREADY_USED" : "HEARTBEAT_INTERNAL_ERROR", requestId);
          }

          step = "UPSERT_HEARTBEAT";
          const { error } = await supabaseAdmin.from("gateway_heartbeats").upsert(
            {
              connector_id: gatewayId,
              gateway_version: String(body.gatewayVersion ?? ""),
              nas_host: toNullableString(body.nasHost),
              nas_reachable: Boolean(body.nasReachable),
              smb_connected: Boolean(body.smbConnected),
              share_accessible: Boolean(body.shareAccessible),
              read_allowed: Boolean(body.readAllowed),
              write_allowed: Boolean(body.writeAllowed),
              total_bytes: toNullableNumber(body.totalBytes),
              used_bytes: toNullableNumber(body.usedBytes),
              available_bytes: toNullableNumber(body.availableBytes),
              pending_jobs: Number(body.pendingJobs ?? 0),
              failed_jobs: Number(body.failedJobs ?? 0),
              last_sync_at: toNullableString(body.lastSyncAt),
              last_error: toNullableString(body.lastError),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "connector_id" },
          );
          if (error) {
            logHeartbeat("error", {
              requestId,
              gatewayId,
              timestamp,
              hasNonce,
              signatureLength,
              step,
              errorType: "HEARTBEAT_UPSERT_ERROR",
              message: error.message,
            });
            return jsonError(500, "HEARTBEAT_INTERNAL_ERROR", requestId);
          }

          logHeartbeat("info", {
            requestId,
            gatewayId,
            timestamp,
            hasNonce,
            signatureLength,
            step: "HEARTBEAT_ACCEPTED",
          });
          return new Response(JSON.stringify({ ok: true, requestId }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (err) {
          logHeartbeat("error", {
            requestId,
            gatewayId,
            timestamp,
            hasNonce,
            signatureLength,
            step,
            errorType: err instanceof Error ? err.name : "UNKNOWN_ERROR",
            message: err instanceof Error ? err.message : "Unknown heartbeat error",
          });
          return jsonError(500, "HEARTBEAT_INTERNAL_ERROR", requestId);
        }
      },
    },
  },
});
