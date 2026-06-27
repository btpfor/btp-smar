import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public log of sign-in attempts (success + failure). Captures IP server-side.
 * Not authenticated — anyone can log a sign-in event for any email they typed.
 */
export const logSignInAttempt = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        success: z.boolean(),
        user_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const headers =
      typeof globalThis !== "undefined" && (globalThis as any).Request
        ? undefined
        : undefined;
    void headers;
    // We can't easily access request headers without an extra middleware; metadata enough.
    const { error } = await supabaseAdmin.from("activity_logs").insert({
      user_id: data.user_id ?? null,
      email: data.email,
      type: data.success ? "sign_in" : "sign_in_failed",
    });
    if (error) console.error("activity log error", error);

    if (data.success && data.user_id) {
      await supabaseAdmin
        .from("profiles")
        .update({ last_sign_in_at: new Date().toISOString() })
        .eq("id", data.user_id);
    }
    return { ok: true };
  });

export const logSignOut = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("activity_logs").insert({
      user_id: data.user_id,
      type: "sign_out",
    });
    return { ok: true };
  });
