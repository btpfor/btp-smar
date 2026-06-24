import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Nouveau mot de passe — Well Done Services" }] }),
  component: ResetPassword,
});

const pwSchema = z.string().min(8, "8 caractères minimum").max(72);

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = pwSchema.safeParse(password);
    if (!r.success) return toast.error(r.error.issues[0].message);
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: r.data });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Mot de passe mis à jour");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-2xl font-bold">Nouveau mot de passe</h1>
          <p className="mt-1 text-sm text-muted-foreground">Définissez votre nouveau mot de passe.</p>
        </div>
        <div>
          <Label htmlFor="pw">Mot de passe</Label>
          <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" required />
        </div>
        <Button type="submit" className="w-full bg-accent hover:bg-accent/90 text-accent-foreground" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Mettre à jour
        </Button>
      </form>
    </div>
  );
}
