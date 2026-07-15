import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

const TRANSIT_BUCKET = "documents";

export const Route = createFileRoute("/api/public/gateway/file-jobs/$id/complete")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);

        const body = (await request.json().catch(() => ({}))) as {
          checksumSha256?: string;
          size?: number;
          synologyRelativePath?: string;
        };

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: job } = await supabaseAdmin
          .from("file_jobs")
          .select("id,type,document_id,document_version_id,transit_storage_key")
          .eq("id", params.id)
          .maybeSingle();
        if (!job) return jsonError(404, "JOB_NOT_FOUND");

        const now = new Date().toISOString();

        if (job.type === "UPLOAD_FILE" && job.document_version_id) {
          await supabaseAdmin
            .from("document_versions")
            .update({
              storage_status: "STORED",
              stored_at: now,
              checksum_sha256: body.checksumSha256 ?? null,
              gateway_id: auth.gatewayId,
              synology_relative_path: body.synologyRelativePath ?? undefined,
            })
            .eq("id", job.document_version_id);

          // Purge du transit après confirmation de stockage
          if (job.transit_storage_key) {
            await supabaseAdmin.storage
              .from(TRANSIT_BUCKET)
              .remove([job.transit_storage_key])
              .catch(() => {});
          }

          await supabaseAdmin.from("document_audit").insert({
            action: "DOCUMENT_STORED",
            document_id: job.document_id,
            document_version_id: job.document_version_id,
            gateway_id: auth.gatewayId,
            result: "OK",
            metadata: { checksumSha256: body.checksumSha256, size: body.size } as never,
          });
        }
        // READ_FILE : on garde le blob transit — le user récupère l'URL signée via getFileJob.

        await supabaseAdmin
          .from("file_jobs")
          .update({ status: "COMPLETED", completed_at: now, error: null })
          .eq("id", params.id);

        return Response.json({ ok: true });
      },
    },
  },
});
