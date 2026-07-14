import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

export const Route = createFileRoute("/api/public/gateway/jobs/$id/complete")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        const body = (await request.json().catch(() => ({}))) as { result?: unknown };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("sync_jobs")
          .update({
            status: "COMPLETED",
            completed_at: new Date().toISOString(),
            result: (body.result ?? {}) as never,
          })
          .eq("id", params.id);
        if (error) return jsonError(500, error.message);
        return Response.json({ ok: true });
      },
    },
  },
});
