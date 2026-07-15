import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, Activity, FileEdit, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listDocumentAudit } from "@/lib/documents.functions";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Audit — Well Done Services" }] }),
  component: AuditPage,
});

function AuditPage() {
  const { isAdmin, loading } = useRoles();

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Accès refusé</h2>
          <p className="text-sm text-muted-foreground">Réservé aux administrateurs.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Journal d'audit</h1>
        <p className="text-sm text-muted-foreground">
          Connexions, déconnexions et modifications des données
        </p>
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">
            <Activity className="mr-2 h-4 w-4" /> Activité
          </TabsTrigger>
          <TabsTrigger value="changes">
            <FileEdit className="mr-2 h-4 w-4" /> Modifications
          </TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>
        <TabsContent value="changes" className="mt-4">
          <ChangesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const ACTIVITY_LABELS: Record<string, { label: string; tone: string }> = {
  sign_in: { label: "Connexion", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  sign_out: { label: "Déconnexion", tone: "bg-muted text-muted-foreground" },
  sign_in_failed: { label: "Échec de connexion", tone: "bg-destructive/15 text-destructive" },
  password_reset: { label: "Mot de passe réinitialisé", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  account_disabled: { label: "Compte désactivé", tone: "bg-destructive/15 text-destructive" },
  account_enabled: { label: "Compte réactivé", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

function ActivityTab() {
  const [type, setType] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["activity-logs", type],
    queryFn: async () => {
      let q = supabase
        .from("activity_logs")
        .select("id, user_id, email, type, created_at, metadata")
        .order("created_at", { ascending: false })
        .limit(200);
      if (type !== "all") q = q.eq("type", type as never);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = data.filter((r) =>
    search ? (r.email ?? "").toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">{filtered.length} évènement(s)</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filtrer par email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {Object.entries(ACTIVITY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <div className="divide-y">
            {filtered.map((r) => {
              const meta = ACTIVITY_LABELS[r.type] ?? { label: r.type, tone: "bg-muted" };
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge className={meta.tone} variant="secondary">{meta.label}</Badge>
                    <span className="font-medium">{r.email ?? "—"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucun évènement.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChangesTab() {
  const [table, setTable] = useState<string>("all");

  const { data = [], isLoading } = useQuery({
    queryKey: ["audit-logs", table],
    queryFn: async () => {
      let q = supabase
        .from("audit_logs")
        .select("id, user_id, table_name, record_id, action, old_data, new_data, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (table !== "all") q = q.eq("table_name", table);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">{data.length} modification(s)</CardTitle>
        <Select value={table} onValueChange={setTable}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les tables</SelectItem>
            <SelectItem value="projects">Projets</SelectItem>
            <SelectItem value="tasks">Tâches</SelectItem>
            <SelectItem value="files">Fichiers</SelectItem>
            <SelectItem value="user_roles">Rôles</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : (
          <div className="space-y-2">
            {data.map((r) => (
              <details key={r.id} className="rounded border bg-muted/30 px-3 py-2 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.table_name}</Badge>
                    <Badge
                      variant="secondary"
                      className={
                        r.action === "delete"
                          ? "bg-destructive/15 text-destructive"
                          : r.action === "insert"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                      }
                    >
                      {r.action}
                    </Badge>
                    <span className="font-mono text-xs">{r.record_id?.slice(0, 8)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("fr-FR")}
                  </span>
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="overflow-x-auto rounded bg-background p-2 text-[10px]">
{JSON.stringify(r.old_data, null, 2)}
                  </pre>
                  <pre className="overflow-x-auto rounded bg-background p-2 text-[10px]">
{JSON.stringify(r.new_data, null, 2)}
                  </pre>
                </div>
              </details>
            ))}
            {data.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucune modification.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
