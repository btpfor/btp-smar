import { createServerFn } from "@tanstack/react-start";

/**
 * Idempotent: creates admin@geco.com / Azerty10@ if no admin exists yet.
 * Public endpoint — safe because it refuses to run once any admin exists.
 */
export const bootstrapAdmin = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { count } = await supabaseAdmin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");

  if ((count ?? 0) > 0) return { created: false, reason: "admin_exists" as const };

  const email = "admin@geco.com";
  const password = "Azerty10@";

  // Try to find existing user with that email
  const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let userId = existing?.users?.find((u) => u.email === email)?.id;

  if (!userId) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Administrateur" },
    });
    if (error) throw new Error(error.message);
    userId = created.user?.id;
  }
  if (!userId) throw new Error("Bootstrap failed");

  await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "admin" });
  await supabaseAdmin.from("profiles").update({ is_active: true }).eq("id", userId);

  return { created: true, email };
});
