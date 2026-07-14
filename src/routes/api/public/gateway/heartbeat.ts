import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

export const Route = createFileRoute("/api/public/gateway/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("gateway_heartbeats").upsert(
          {
            connector_id: auth.gatewayId,
            gateway_version: String(body.gatewayVersion ?? ""),
            nas_host: (body.nasHost as string) ?? null,
            nas_reachable: Boolean(body.nasReachable),
            smb_connected: Boolean(body.smbConnected),
            total_bytes: (body.totalBytes as number) ?? null,
            used_bytes: (body.usedBytes as number) ?? null,
            available_bytes: (body.availableBytes as number) ?? null,
            pending_jobs: Number(body.pendingJobs ?? 0),
            failed_jobs: Number(body.failedJobs ?? 0),
            last_sync_at: (body.lastSyncAt as string) ?? null,
            last_error: (body.lastError as string) ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "connector_id" },
        );
        if (error) return jsonError(500, error.message);
        return Response.json({ ok: true });
      },
    },
  },
});
