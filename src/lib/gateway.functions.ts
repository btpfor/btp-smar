import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Parse un préfixe de type "STEP_NAME: ..." pour dériver l'étape d'échec. */
function extractFailureStep(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const m = msg.match(/^([A-Z][A-Z0-9_]{2,})[\s:]/);
  return m ? m[1] : null;
}

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
    .select("id,operation,source_path,destination_path,last_error,status,completed_at,created_at,connector_id")
    .in("status", ["FAILED", "CONFLICT"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});

// ---------- Nouvelles fonctions d'admin ----------

/** Liste tous les gateways connus (via heartbeats) + statut en ligne/étape d'échec. */
export const listGateways = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hbs, error } = await supabaseAdmin
      .from("gateway_heartbeats")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: states } = await supabaseAdmin
      .from("gateway_alert_state" as never)
      .select("*");

    const stateMap = new Map<string, { is_offline: boolean; last_notified_at: string | null; last_checked_at: string }>();
    for (const s of (states ?? []) as Array<{ connector_id: string; is_offline: boolean; last_notified_at: string | null; last_checked_at: string }>) {
      stateMap.set(s.connector_id, s);
    }

    const now = Date.now();
    return (hbs ?? []).map((h) => {
      const lastUpdate = new Date(h.updated_at).getTime();
      const online = now - lastUpdate < 2 * 60 * 1000;
      const state = stateMap.get(h.connector_id);
      return {
        connectorId: h.connector_id,
        gatewayVersion: h.gateway_version,
        nasHost: h.nas_host,
        nasReachable: h.nas_reachable,
        smbConnected: h.smb_connected,
        pendingJobs: h.pending_jobs,
        failedJobs: h.failed_jobs,
        lastSyncAt: h.last_sync_at,
        lastError: h.last_error,
        failureStep: extractFailureStep(h.last_error),
        updatedAt: h.updated_at,
        online,
        isOfflineFlagged: state?.is_offline ?? !online,
        lastNotifiedAt: state?.last_notified_at ?? null,
      };
    });
  });

/** Historique récent des erreurs par gateway. */
export const listGatewayErrorHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { connectorId: string; limit?: number })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("sync_jobs")
      .select("id,operation,source_path,destination_path,last_error,status,completed_at,created_at")
      .eq("connector_id", data.connectorId)
      .in("status", ["FAILED", "CONFLICT"])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(data.limit ?? 20, 100));
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      ...r,
      failureStep: extractFailureStep(r.last_error),
    }));
  });

/** Paramètres d'alerte "hors ligne". */
export const getAlertSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("gateway_alert_settings" as never)
      .select("*")
      .eq("id" as never, true as never)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as {
      offline_threshold_minutes: number;
      notify_frequency_minutes: number;
      email_enabled: boolean;
      email_recipients: string[];
      updated_at: string;
    } | null;
    return row ?? {
      offline_threshold_minutes: 5,
      notify_frequency_minutes: 30,
      email_enabled: false,
      email_recipients: [],
      updated_at: new Date().toISOString(),
    };
  });

export const updateAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    data as {
      offlineThresholdMinutes: number;
      notifyFrequencyMinutes: number;
      emailEnabled: boolean;
      emailRecipients: string[];
    },
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("FORBIDDEN");

    const threshold = Math.max(1, Math.min(1440, Math.floor(data.offlineThresholdMinutes)));
    const frequency = Math.max(1, Math.min(1440, Math.floor(data.notifyFrequencyMinutes)));
    const recipients = (data.emailRecipients ?? [])
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
      .slice(0, 20);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("gateway_alert_settings" as never)
      .upsert({
        id: true,
        offline_threshold_minutes: threshold,
        notify_frequency_minutes: frequency,
        email_enabled: Boolean(data.emailEnabled),
        email_recipients: recipients,
        updated_at: new Date().toISOString(),
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
