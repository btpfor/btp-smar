import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRoles } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Shown only when the database has no admin yet AND the current user has no admin role.
 * Lets the first signed-in person bootstrap themselves as administrator.
 */
export function AdminBootstrap() {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const qc = useQueryClient();

  const { data: adminExists, isLoading } = useQuery({
    queryKey: ["admin-exists"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });

  const promote = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: user.id, role: "admin" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Vous êtes maintenant administrateur");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || isAdmin || adminExists) return null;

  return (
    <Card className="border-accent/40 bg-accent/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Première connexion : devenez administrateur</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Aucun administrateur n'existe encore. Initialisez la plateforme en vous attribuant ce rôle —
              vous pourrez ensuite gérer les utilisateurs et leurs rôles.
            </p>
          </div>
        </div>
        <Button
          onClick={() => promote.mutate()}
          disabled={promote.isPending}
          className="bg-accent hover:bg-accent/90 text-accent-foreground"
        >
          Devenir administrateur
        </Button>
      </CardContent>
    </Card>
  );
}
