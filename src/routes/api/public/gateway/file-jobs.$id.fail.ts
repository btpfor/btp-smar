import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

export const Route = createFileRoute("/api/public/gateway/file-jobs/$id/fail")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);

        const body = (await request.json().catch(() => ({}))) as { error?: string };
        const errorMsg = String(body.error ?? "UNKNOWN").slice(0, 2000);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: job } = await supabaseAdmin
          .from("file_jobs")
          .select("id,attempt_count,max_attempts,type,document_id,document_version_id")
          .eq("id", params.id)
          .maybeSingle();
        if (!job) return jsonError(404, "JOB_NOT_FOUND");

        const isRetry = (job.attempt_count ?? 0) < (job.max_attempts ?? 5);
        const nextStatus = isRetry ? "RETRY" : "FAILED";
        const backoffSec = Math.min(60 * Math.pow(2, job.attempt_count ?? 0), 60 * 30);
        const nextRetryAt = isRetry ? new Date(Date.now() + backoffSec * 1000).toISOString() : null;

        await supabaseAdmin
          .from("file_jobs")
          .update({
            status: nextStatus,
            error: errorMsg,
            next_retry_at: nextRetryAt,
            completed_at: isRetry ? null : new Date().toISOString(),
          })
          .eq("id", params.id);

        if (!isRetry && job.type === "UPLOAD_FILE" && job.document_version_id) {
          await supabaseAdmin
            .from("document_versions")
            .update({ storage_status: "STORAGE_FAILED", storage_error: errorMsg })
            .eq("id", job.document_version_id);
          await supabaseAdmin.from("document_audit").insert({
            action: "DOCUMENT_STORAGE_FAILED",
            document_id: job.document_id,
            document_version_id: job.document_version_id,
            gateway_id: auth.gatewayId,
            result: "FAILED",
            metadata: { error: errorMsg } as never,
          });
        }

        return Response.json({ ok: true, retry: isRetry });
      },
    },
  },
});
