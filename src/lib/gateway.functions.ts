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
