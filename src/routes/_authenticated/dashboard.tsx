import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, TrendingUp, CheckCircle2, Clock, Plus } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS, type ProjectStatus } from "@/lib/roles";
import { AdminBootstrap } from "@/components/AdminBootstrap";
import { SynologyHealthCard } from "@/components/SynologyHealthCard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord — Well Done Services" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, status, progress, created_at, project_number, client_name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const stats = {
    total: projects.length,
    enCours: projects.filter((p) => p.status === "en_cours").length,
    termines: projects.filter((p) => p.status === "termine").length,
    avgProgress:
      projects.length === 0
        ? 0
        : Math.round(projects.reduce((s, p) => s + (p.progress ?? 0), 0) / projects.length),
  };

  const statusData = (["en_preparation", "en_cours", "suspendu", "termine"] as ProjectStatus[]).map(
    (s) => ({
      name: STATUS_LABELS[s],
      value: projects.filter((p) => p.status === s).length,
    }),
  );

  const progressData = projects.slice(0, 8).map((p) => ({
    name: p.project_number,
    avancement: p.progress ?? 0,
  }));

  const pieColors = [
    "oklch(0.50 0.03 250)",
    "oklch(0.42 0.11 246)",
    "oklch(0.78 0.16 80)",
    "oklch(0.62 0.16 150)",
  ];

  return (
    <div className="space-y-6">
      <AdminBootstrap />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Vue d'ensemble de vos projets BTP</p>
        </div>
        <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Link to="/projects">
            <Plus className="mr-2 h-4 w-4" /> Nouveau projet
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FolderKanban} label="Projets total" value={stats.total} tone="primary" />
        <StatCard icon={Clock} label="En cours" value={stats.enCours} tone="accent" />
        <StatCard icon={CheckCircle2} label="Terminés" value={stats.termines} tone="success" />
        <StatCard icon={TrendingUp} label="Avancement moyen" value={`${stats.avgProgress}%`} tone="primary" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Avancement par projet</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {progressData.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={progressData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.01 240)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="avancement" fill="oklch(0.71 0.20 47)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Répartition par statut</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {projects.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={pieColors[i]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projets récents</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : projects.length === 0 ? (
            <Empty />
          ) : (
            <div className="divide-y">
              {projects.slice(0, 5).map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.project_number} {p.client_name ? `· ${p.client_name}` : ""}
                    </div>
                  </div>
                  <div className="text-sm text-accent">{p.progress ?? 0}%</div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  tone: "primary" | "accent" | "success";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/15 text-accent",
    success: "bg-success/15 text-success",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Aucun projet pour le moment.
    </div>
  );
}
