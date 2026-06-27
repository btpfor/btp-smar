import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  role: z.enum(["admin", "chef_projet", "ingenieur", "client"]),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Réservé aux administrateurs");
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const newId = created.user?.id;
    if (!newId) throw new Error("Création échouée");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: data.role });
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin
      .from("profiles")
      .update({
        phone: data.phone || null,
        created_by: context.userId,
        is_active: true,
      })
      .eq("id", newId);

    return { id: newId };
  });

export const adminSetUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("Impossible de se désactiver soi-même");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ban_duration "none" re-enables; long duration disables sign-in
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("profiles").update({ is_active: data.active }).eq("id", data.user_id);
    await supabaseAdmin.from("activity_logs").insert({
      user_id: data.user_id,
      type: data.active ? "account_enabled" : "account_disabled",
      metadata: { by: context.userId },
    });
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid(), password: z.string().min(8).max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("activity_logs").insert({
      user_id: data.user_id,
      type: "password_reset",
      metadata: { by: context.userId },
    });
    return { ok: true };
  });
