import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

export const Route = createFileRoute("/api/public/gateway/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("sync_jobs")
          .select("*")
          .eq("status", "PENDING")
          .order("created_at", { ascending: true })
          .limit(25);
        if (error) return jsonError(500, error.message);
        return Response.json({ jobs: data ?? [] });
      },
    },
  },
});
