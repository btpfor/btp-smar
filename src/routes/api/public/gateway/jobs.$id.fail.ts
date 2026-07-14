import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

export const Route = createFileRoute("/api/public/gateway/jobs/$id/fail")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        const body = (await request.json().catch(() => ({}))) as {
          error?: string;
          status?: "FAILED" | "CONFLICT";
        };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: upErr } = await supabaseAdmin
          .from("sync_jobs")
          .update({
            status: body.status ?? "FAILED",
            last_error: body.error ?? "unknown",
            completed_at: new Date().toISOString(),
          })
          .eq("id", params.id);
        if (upErr) return jsonError(500, upErr.message);
        return Response.json({ ok: true });
      },
    },
  },
});
