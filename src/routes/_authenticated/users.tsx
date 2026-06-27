import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert, UserPlus, Loader2, KeyRound, Power, Search } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRoles } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import {
  adminCreateUser,
  adminSetUserActive,
  adminResetPassword,
} from "@/lib/admin-users.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Utilisateurs — Well Done Services" }] }),
  component: UsersPage,
});

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  last_sign_in_at: string | null;
  created_at: string;
  roles: AppRole[];
};

function UsersPage() {
  const { isAdmin, loading } = useRoles();
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, phone, is_active, last_sign_in_at, created_at")
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

  const setActiveFn = useServerFn(adminSetUserActive);
  const setActive = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      setActiveFn({ data: { user_id: userId, active } }),
    onSuccess: (_d, v) => {
      toast.success(v.active ? "Compte réactivé" : "Compte désactivé");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (search) {
        const s = search.toLowerCase();
        if (!u.email.toLowerCase().includes(s) && !(u.full_name ?? "").toLowerCase().includes(s)) {
          return false;
        }
      }
      if (roleFilter !== "all" && !u.roles.includes(roleFilter as AppRole)) return false;
      if (statusFilter === "active" && !u.is_active) return false;
      if (statusFilter === "disabled" && u.is_active) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">Créez les comptes et gérez les accès</p>
        </div>
        <CreateUserDialog />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {filtered.length} / {users.length} utilisateur{users.length > 1 ? "s" : ""}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="w-56 pl-8"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Rôle" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les rôles</SelectItem>
                {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="active">Actifs</SelectItem>
                <SelectItem value="disabled">Désactivés</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <div className="divide-y">
              {filtered.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{u.full_name ?? "—"}</span>
                      {!u.is_active && <Badge variant="destructive" className="text-[10px]">Désactivé</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    {u.last_sign_in_at && (
                      <div className="text-[10px] text-muted-foreground">
                        Dernière connexion : {new Date(u.last_sign_in_at).toLocaleString("fr-FR")}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={u.roles[0] ?? "ingenieur"}
                      onValueChange={(role) => setRole.mutate({ userId: u.id, role: role as AppRole })}
                    >
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ResetPasswordButton userId={u.id} email={u.email} />
                    <Button
                      variant={u.is_active ? "outline" : "default"}
                      size="sm"
                      disabled={u.id === currentUser?.id || setActive.isPending}
                      onClick={() => setActive.mutate({ userId: u.id, active: !u.is_active })}
                      title={u.id === currentUser?.id ? "Impossible de se désactiver" : ""}
                    >
                      <Power className="mr-1 h-3.5 w-3.5" />
                      {u.is_active ? "Désactiver" : "Réactiver"}
                    </Button>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Aucun utilisateur.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const createSchema = z.object({
  email: z.string().trim().email("Email invalide"),
  password: z.string().min(8, "8 caractères minimum"),
  full_name: z.string().trim().min(2, "Nom trop court"),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(["admin", "chef_projet", "ingenieur", "client"]),
});

function CreateUserDialog() {
  const qc = useQueryClient();
  const create = useServerFn(adminCreateUser);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AppRole>("ingenieur");

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = createSchema.parse({ email, password, full_name: fullName, phone, role });
      return create({ data: parsed });
    },
    onSuccess: () => {
      toast.success("Compte créé");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setOpen(false);
      setEmail(""); setPassword(""); setFullName(""); setPhone(""); setRole("ingenieur");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <UserPlus className="mr-2 h-4 w-4" /> Créer un compte
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvel utilisateur</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cu-name">Nom complet</Label>
            <Input id="cu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="cu-email">Email</Label>
            <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="cu-phone">Téléphone</Label>
            <Input id="cu-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="cu-pw">Mot de passe temporaire</Label>
            <Input id="cu-pw" type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-muted-foreground">Minimum 8 caractères. Communiquez-le à l'utilisateur.</p>
          </div>
          <div>
            <Label>Rôle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Annuler</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordButton({ userId, email }: { userId: string; email: string }) {
  const reset = useServerFn(adminResetPassword);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (pw.length < 8) throw new Error("8 caractères minimum");
      return reset({ data: { user_id: userId, password: pw } });
    },
    onSuccess: () => {
      toast.success("Mot de passe réinitialisé");
      setOpen(false);
      setPw("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="mr-1 h-3.5 w-3.5" /> Mot de passe
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Définissez un nouveau mot de passe pour <span className="font-medium">{email}</span>.
          </p>
          <div>
            <Label htmlFor="rp-pw">Nouveau mot de passe</Label>
            <Input
              id="rp-pw"
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mut.isPending}>Annuler</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
