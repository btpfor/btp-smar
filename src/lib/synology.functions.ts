import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_HOST = "192.168.1.21";
const DEFAULT_PORT = 5000;

const upsertSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(DEFAULT_PORT),
});

export const getSynologyConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId?: string | null }) => ({
    projectId: input?.projectId ?? null,
  }))
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("synology_configs")
      .select("id, host, port, project_id, updated_at")
      .eq("user_id", context.userId);

    const { data: row, error } = data.projectId
      ? await q.eq("project_id", data.projectId).maybeSingle()
      : await q.is("project_id", null).maybeSingle();

    if (error) throw new Error(error.message);
    return (
      row ?? {
        id: null,
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        project_id: data.projectId,
        updated_at: null,
      }
    );
  });

export const listSynologyConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("synology_configs")
      .select("id, host, port, project_id, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveSynologyConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      project_id: data.projectId ?? null,
      host: data.host,
      port: data.port,
    };
    const { data: row, error } = await context.supabase
      .from("synology_configs")
      .upsert(payload, { onConflict: "user_id,project_id" })
      .select("id, host, port, project_id, updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSynologyConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("synology_configs")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Contrôle de santé : effectue une vraie requête HTTP vers http://host:port/
 * depuis le serveur (le navigateur ne peut pas atteindre un LAN privé).
 * Ne renvoie que des informations non sensibles.
 */
export const checkSynologyHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const schema = z.object({
      host: z.string().trim().min(1).max(255).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      projectId: z.string().uuid().nullable().optional(),
    });
    return schema.parse(input ?? {});
  })
  .handler(async ({ data, context }) => {
    let host = data.host;
    let port = data.port;
    if (!host || !port) {
      const q = context.supabase
        .from("synology_configs")
        .select("host, port")
        .eq("user_id", context.userId);
      const { data: row } = data.projectId
        ? await q.eq("project_id", data.projectId).maybeSingle()
        : await q.is("project_id", null).maybeSingle();
      host = host ?? row?.host ?? DEFAULT_HOST;
      port = port ?? row?.port ?? DEFAULT_PORT;
    }

    const url = `http://${host}:${port}/`;
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
      });
      const latencyMs = Date.now() - started;
      // DSM répond 200/302/307 sur "/" — tout code < 500 = joignable.
      const reachable = res.status < 500;
      return {
        ok: reachable,
        status: res.status,
        latencyMs,
        host,
        port,
        url,
        error: null as string | null,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const msg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Timeout (5s) — hôte injoignable depuis le serveur"
            : err.message
          : "Erreur inconnue";
      return {
        ok: false,
        status: 0,
        latencyMs,
        host,
        port,
        url,
        error: msg,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  });
