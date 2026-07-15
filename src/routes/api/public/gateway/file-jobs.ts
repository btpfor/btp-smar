import { createFileRoute } from "@tanstack/react-router";
import { verifyGatewayRequest, jsonError } from "@/lib/gateway-auth.server";

const TRANSIT_BUCKET = "documents";
const MAX_CLAIM = 5;

/**
 * GET → Réclame jusqu'à N file_jobs PENDING pour ce gateway, les passe en CLAIMED,
 * et joint les URLs signées (download pour UPLOAD_FILE, upload pour READ_FILE).
 * Ne renvoie JAMAIS de secret SMB : la Gateway lit uniquement des URLs signées TTL.
 */
export const Route = createFileRoute("/api/public/gateway/file-jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await verifyGatewayRequest(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Sélectionne + marque CLAIMED en une passe (best-effort, sans row-lock strict).
        const { data: candidates } = await supabaseAdmin
          .from("file_jobs")
          .select("id,type,payload,attempt_count,transit_storage_key,document_id,document_version_id,project_id")
          .in("status", ["PENDING", "RETRY"])
          .lte("attempt_count", 4)
          .order("created_at", { ascending: true })
          .limit(MAX_CLAIM);

        const jobs: Array<Record<string, unknown>> = [];
        for (const j of candidates ?? []) {
          const { data: claimed } = await supabaseAdmin
            .from("file_jobs")
            .update({
              status: "CLAIMED",
              claimed_at: new Date().toISOString(),
              gateway_id: auth.gatewayId,
              attempt_count: (j.attempt_count ?? 0) + 1,
            })
            .eq("id", j.id)
            .in("status", ["PENDING", "RETRY"])
            .select("id")
            .maybeSingle();
          if (!claimed) continue; // un autre pull l'a déjà pris

          const enriched: Record<string, unknown> = {
            id: j.id,
            type: j.type,
            documentId: j.document_id,
            versionId: j.document_version_id,
            projectId: j.project_id,
            payload: j.payload,
          };

          const transitKey = j.transit_storage_key as string | null;
          if (j.type === "UPLOAD_FILE" && transitKey) {
            const { data: signed } = await supabaseAdmin.storage
              .from(TRANSIT_BUCKET)
              .createSignedUrl(transitKey, 60 * 15);
            enriched.transitDownloadUrl = signed?.signedUrl ?? null;
          } else if (j.type === "READ_FILE" && transitKey) {
            const { data: signed } = await supabaseAdmin.storage
              .from(TRANSIT_BUCKET)
              .createSignedUploadUrl(transitKey);
            enriched.transitUploadUrl = signed?.signedUrl ?? null;
            enriched.transitUploadToken = signed?.token ?? null;
          }
          jobs.push(enriched);
        }

        return Response.json({ jobs });
      },
    },
  },
});
