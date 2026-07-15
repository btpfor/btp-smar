import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint public de monitoring : dernier heartbeat + étape d'échec par gateway.
 * N'expose AUCUN secret (id/version/host/statuts/étape uniquement).
 * Auth : header `x-monitoring-key` doit correspondre à MONITORING_KEY si défini,
 * sinon la route reste ouverte pour lecture (aucun secret exposé).
 */

function extractFailureStep(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const m = msg.match(/^([A-Z][A-Z0-9_]{2,})[\s:]/);
  return m ? m[1] : null;
}

export const Route = createFileRoute("/api/public/gateway/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const monitoringKey = process.env.MONITORING_KEY;
        if (monitoringKey) {
          const provided = request.headers.get("x-monitoring-key");
          if (provided !== monitoringKey) {
            return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            });
          }
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("gateway_heartbeats")
          .select(
            "connector_id,gateway_version,nas_host,nas_reachable,smb_connected,share_accessible,read_allowed,write_allowed,pending_jobs,failed_jobs,last_sync_at,last_error,updated_at",
          )
          .order("updated_at", { ascending: false });

        if (error) {
          return new Response(JSON.stringify({ error: "INTERNAL" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const now = Date.now();
        const gateways = (data ?? []).map((h) => ({
          connectorId: h.connector_id,
          gatewayVersion: h.gateway_version,
          nasHost: h.nas_host,
          nasReachable: h.nas_reachable,
          smbConnected: h.smb_connected,
          shareAccessible: h.share_accessible,
          readAllowed: h.read_allowed,
          writeAllowed: h.write_allowed,
          pendingJobs: h.pending_jobs,
          failedJobs: h.failed_jobs,
          lastSyncAt: h.last_sync_at,
          lastError: h.last_error,
          failureStep: extractFailureStep(h.last_error),
          updatedAt: h.updated_at,
          online: now - new Date(h.updated_at).getTime() < 2 * 60 * 1000,
        }));

        return new Response(
          JSON.stringify({ generatedAt: new Date().toISOString(), gateways }),
          {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          },
        );
      },
    },
  },
});
