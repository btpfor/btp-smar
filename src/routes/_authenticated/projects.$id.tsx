import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_LABELS, STATUS_COLORS, type ProjectStatus } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Projet — Well Done Services" }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canManageProjects } = useRoles();

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<typeof project | null>(null);
  useEffect(() => {
    if (project) setForm(project);
  }, [project]);

  const update = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { error } = await supabase
        .from("projects")
        .update({
          name: form.name,
          description: form.description,
          client_name: form.client_name,
          start_date: form.start_date,
          end_date: form.end_date,
          budget: form.budget,
          status: form.status,
          progress: form.progress,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Projet mis à jour");
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Projet supprimé");
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/projects" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !form) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (!project)
    return (
      <p className="text-sm text-muted-foreground">
        Projet introuvable ou vous n'avez pas accès.{" "}
        <Link to="/projects" className="text-primary underline">Retour</Link>
      </p>
    );

  const readOnly = !canManageProjects;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/projects"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="text-xs font-mono text-muted-foreground">{project.project_number}</div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-sm ${STATUS_COLORS[project.status as ProjectStatus]}`}
        >
          {STATUS_LABELS[project.status as ProjectStatus]}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Détails</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Fld label="Nom du projet"><Input value={form.name} disabled={readOnly} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
            <Fld label="Description"><Textarea rows={4} value={form.description ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Fld>
            <Fld label="Client"><Input value={form.client_name ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Date début"><Input type="date" value={form.start_date ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Fld>
              <Fld label="Date fin"><Input type="date" value={form.end_date ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Fld>
            </div>
            <Fld label="Budget (XAF)"><Input type="number" value={form.budget ?? ""} disabled={readOnly} onChange={(e) => setForm({ ...form, budget: e.target.value ? Number(e.target.value) : null })} /></Fld>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Statut</CardTitle></CardHeader>
            <CardContent>
              <Select value={form.status} disabled={readOnly} onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Avancement</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Progression</span>
                <span className="text-2xl font-bold text-accent">{form.progress ?? 0}%</span>
              </div>
              <Progress value={form.progress ?? 0} />
              {!readOnly && (
                <Slider
                  value={[form.progress ?? 0]}
                  max={100}
                  step={1}
                  onValueChange={([v]) => setForm({ ...form, progress: v })}
                />
              )}
            </CardContent>
          </Card>

          {!readOnly && (
            <div className="flex flex-col gap-2">
              <Button onClick={() => update.mutate()} disabled={update.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Save className="mr-2 h-4 w-4" /> Enregistrer les modifications
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm("Supprimer ce projet ? Cette action est irréversible.")) remove.mutate();
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Supprimer
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
