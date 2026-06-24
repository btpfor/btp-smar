import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRoles } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { STATUS_LABELS, STATUS_COLORS, type ProjectStatus } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projets — Well Done Services" }] }),
  component: ProjectsList,
});

const projectSchema = z.object({
  project_number: z.string().trim().min(1, "Numéro requis").max(50),
  name: z.string().trim().min(2, "Nom trop court").max(200),
  description: z.string().trim().max(2000).optional(),
  client_name: z.string().trim().max(200).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  budget: z.string().optional(),
  status: z.enum(["en_preparation", "en_cours", "suspendu", "termine"]),
});

function ProjectsList() {
  const { canManageProjects } = useRoles();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.project_number.toLowerCase().includes(search.toLowerCase()) ||
      (p.client_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Projets</h1>
          <p className="text-sm text-muted-foreground">Tous les chantiers que vous pouvez consulter</p>
        </div>
        {canManageProjects && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Plus className="mr-2 h-4 w-4" /> Nouveau projet
              </Button>
            </DialogTrigger>
            <NewProjectDialog onDone={() => setOpen(false)} />
          </Dialog>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher (nom, numéro, client)…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {projects.length === 0
              ? "Aucun projet pour le moment."
              : "Aucun projet ne correspond à votre recherche."}
          </p>
          {canManageProjects && projects.length === 0 && (
            <Button
              className="mt-4 bg-accent hover:bg-accent/90 text-accent-foreground"
              onClick={() => setOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" /> Créer le premier projet
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to="/projects/$id"
              params={{ id: p.id }}
              className="group rounded-xl border bg-card p-5 transition-shadow hover:shadow-[var(--shadow-elegant)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-muted-foreground">{p.project_number}</div>
                  <h3 className="mt-1 truncate font-semibold group-hover:text-primary">{p.name}</h3>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[p.status as ProjectStatus]}`}
                >
                  {STATUS_LABELS[p.status as ProjectStatus]}
                </span>
              </div>
              {p.client_name && (
                <p className="mt-2 text-xs text-muted-foreground">Client : {p.client_name}</p>
              )}
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avancement</span>
                  <span className="font-semibold">{p.progress ?? 0}%</span>
                </div>
                <Progress value={p.progress ?? 0} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectDialog({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    project_number: "",
    name: "",
    description: "",
    client_name: "",
    start_date: "",
    end_date: "",
    budget: "",
    status: "en_preparation" as ProjectStatus,
  });

  const mut = useMutation({
    mutationFn: async () => {
      const parsed = projectSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const v = parsed.data;
      const { error } = await supabase.from("projects").insert({
        project_number: v.project_number,
        name: v.name,
        description: v.description || null,
        client_name: v.client_name || null,
        start_date: v.start_date || null,
        end_date: v.end_date || null,
        budget: v.budget ? Number(v.budget) : null,
        status: v.status,
        created_by: user?.id,
        manager_id: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Projet créé");
      qc.invalidateQueries({ queryKey: ["projects"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Nouveau projet</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <Fld label="N° projet *" id="num">
            <Input id="num" value={form.project_number} onChange={(e) => setForm({ ...form, project_number: e.target.value })} required />
          </Fld>
          <Fld label="Statut" id="st">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Fld>
        </div>
        <Fld label="Nom *" id="nm">
          <Input id="nm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Fld>
        <Fld label="Description" id="ds">
          <Textarea id="ds" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Fld>
        <Fld label="Client" id="cl">
          <Input id="cl" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
        </Fld>
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Date début" id="sd">
            <Input id="sd" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Fld>
          <Fld label="Date fin" id="ed">
            <Input id="ed" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Fld>
        </div>
        <Fld label="Budget (XAF)" id="bg">
          <Input id="bg" type="number" min="0" step="1" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </Fld>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>Annuler</Button>
          <Button type="submit" disabled={mut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
            {mut.isPending ? "Création…" : "Créer le projet"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Fld({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
