import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Utilisateurs — Well Done Services" }] }),
  component: UsersPage,
});

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  roles: AppRole[];
};

function UsersPage() {
  const { isAdmin, loading } = useRoles();
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const { data: roles, error: rErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rErr) throw rErr;
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? [])
          .filter((r) => r.user_id === p.id)
          .map((r) => r.role as AppRole),
      }));
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      // Replace user's roles with single role (simple model for V1)
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      toast.success("Rôle mis à jour");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Accès refusé</h2>
          <p className="text-sm text-muted-foreground">
            Cette page est réservée aux administrateurs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">Attribuez les rôles à chaque utilisateur</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{users.length} utilisateur{users.length > 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <div className="divide-y">
              {users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-medium">{u.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={u.roles[0] ?? "ingenieur"}
                      onValueChange={(role) => setRole.mutate({ userId: u.id, role: role as AppRole })}
                    >
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Aucun utilisateur.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Button
        variant="outline"
        onClick={async () => {
          const { data } = await supabase.auth.getUser();
          if (!data.user) return;
          await supabase.from("user_roles").upsert({ user_id: data.user.id, role: "admin" }, { onConflict: "user_id,role" });
          toast.success("Vous êtes maintenant administrateur");
          qc.invalidateQueries({ queryKey: ["admin-users"] });
        }}
      >
        Me promouvoir administrateur (debug)
      </Button>
    </div>
  );
}
