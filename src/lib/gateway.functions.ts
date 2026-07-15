import { createServerFn } from "@tanstack/react-start";

export const getGatewayStatus = createServerFn({ method: "GET" }).handler(async () => {
  const configured = Boolean(
    process.env.GECO_GATEWAY_ID && process.env.GECO_GATEWAY_SECRET,
  );
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: hb } = await supabaseAdmin
    .from("gateway_heartbeats")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: pending } = await supabaseAdmin
    .from("sync_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "PENDING");
  const { count: failed } = await supabaseAdmin
    .from("sync_jobs")
    .select("*", { count: "exact", head: true })
    .in("status", ["FAILED", "CONFLICT"]);

  const now = Date.now();
  const lastUpdate = hb ? new Date(hb.updated_at).getTime() : 0;
  const online = Boolean(hb) && now - lastUpdate < 2 * 60 * 1000;

  return {
    configured,
    online,
    heartbeat: hb,
    pendingJobs: pending ?? 0,
    failedJobs: failed ?? 0,
    checkedAt: new Date().toISOString(),
  };
});

export const runGatewaySync = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { operation?: string })
  .handler(async () => {
    // Le Gateway pollue lui-même toutes les POLL_INTERVAL_MS ; ici on
    // se contente de confirmer la présence de tâches en attente.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("sync_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "PENDING");
    return { queued: count ?? 0 };
  });

export const startGatewayDiagnostic = createServerFn({ method: "POST" }).handler(async () => {
  const gatewayId = process.env.GECO_GATEWAY_ID;
  if (!gatewayId) throw new Error("GATEWAY_NOT_CONFIGURED");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("sync_jobs")
    .insert({
      connector_id: gatewayId,
      operation: "GATEWAY_DIAGNOSTIC" as never,
      payload: { requestedAt: new Date().toISOString() } as never,
      status: "PENDING",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { jobId: data.id };
});

export const getGatewayDiagnostic = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { jobId: string })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("sync_jobs")
      .select("id,status,result,last_error,created_at,started_at,completed_at")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const listGatewayErrors = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("sync_jobs")
    .select("id,operation,source_path,destination_path,last_error,status,completed_at,created_at")
    .in("status", ["FAILED", "CONFLICT"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});

