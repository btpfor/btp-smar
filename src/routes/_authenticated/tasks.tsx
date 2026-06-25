import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Calendar, Flag, User as UserIcon, GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRoles } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

type Priority = "basse" | "normale" | "haute" | "urgente";
type Status = "a_faire" | "en_cours" | "termine";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  assigned_to: string | null;
  created_by: string | null;
  project_id: string | null;
  due_date: string | null;
  created_at: string;
};

const PRIORITY_LABELS: Record<Priority, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};
const PRIORITY_COLORS: Record<Priority, string> = {
  basse: "bg-muted text-muted-foreground",
  normale: "bg-primary/10 text-primary",
  haute: "bg-accent/15 text-accent",
  urgente: "bg-destructive/15 text-destructive",
};
const STATUS_LABELS: Record<Status, string> = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
};
const STATUSES: Status[] = ["a_faire", "en_cours", "termine"];

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "Tâches — Well Done Services" }] }),
  component: TasksPage,
});

function TasksPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canManageProjects, isAdmin } = useRoles();
  const canManage = canManageProjects || isAdmin;
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,email");
      return data ?? [];
    },
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").order("name");
      return data ?? [];
    },
  });
  const userName = (id: string | null) => {
    if (!id) return "—";
    const p = profiles.find((x) => x.id === id);
    return p?.full_name ?? p?.email ?? "Utilisateur";
  };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      qc.setQueryData<Task[]>(["tasks"], (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tâche supprimée");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(
    () =>
      STATUSES.reduce(
        (acc, s) => {
          acc[s] = tasks.filter((t) => t.status === s);
          return acc;
        },
        {} as Record<Status, Task[]>,
      ),
    [tasks],
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  const canMove = (t: Task) => canManage || t.assigned_to === user?.id;

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const taskId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !canMove(task)) {
      if (task && !canMove(task)) toast.error("Vous ne pouvez pas déplacer cette tâche");
      return;
    }
    const newStatus = (STATUSES as string[]).includes(overId)
      ? (overId as Status)
      : tasks.find((t) => t.id === overId)?.status;
    if (!newStatus || newStatus === task.status) return;
    updateStatus.mutate({ id: taskId, status: newStatus });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tâches</h1>
          <p className="text-sm text-muted-foreground">
            Glissez-déposez une carte pour changer son statut
          </p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Plus className="mr-2 h-4 w-4" /> Nouvelle tâche
              </Button>
            </DialogTrigger>
            <NewTaskDialog
              projects={projects}
              profiles={profiles}
              onDone={() => setOpen(false)}
              userId={user?.id ?? ""}
            />
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid gap-4 lg:grid-cols-3">
            {STATUSES.map((s) => (
              <Column
                key={s}
                status={s}
                tasks={columns[s]}
                userName={userName}
                canManage={canManage}
                canMove={canMove}
                onDelete={(id) => confirm("Supprimer cette tâche ?") && remove.mutate(id)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? <TaskCardView task={activeTask} userName={userName} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function Column({
  status,
  tasks,
  userName,
  canManage,
  canMove,
  onDelete,
}: {
  status: Status;
  tasks: Task[];
  userName: (id: string | null) => string;
  canManage: boolean;
  canMove: (t: Task) => boolean;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border bg-muted/30 p-3 transition-colors ${isOver ? "border-accent bg-accent/5" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{STATUS_LABELS[status]}</h3>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
      <div className="space-y-2 min-h-24">
        {tasks.length === 0 ? (
          <p className="rounded border border-dashed py-6 text-center text-xs text-muted-foreground">
            Déposez ici
          </p>
        ) : (
          tasks.map((t) => (
            <DraggableTask
              key={t.id}
              task={t}
              userName={userName}
              draggable={canMove(t)}
              canManage={canManage}
              onDelete={() => onDelete(t.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableTask({
  task,
  userName,
  draggable,
  canManage,
  onDelete,
}: {
  task: Task;
  userName: (id: string | null) => string;
  draggable: boolean;
  canManage: boolean;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <TaskCardView
        task={task}
        userName={userName}
        handleProps={draggable ? { ...attributes, ...listeners } : undefined}
        canManage={canManage}
        onDelete={onDelete}
      />
    </div>
  );
}

function TaskCardView({
  task,
  userName,
  handleProps,
  canManage,
  onDelete,
  dragging,
}: {
  task: Task;
  userName: (id: string | null) => string;
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
  canManage?: boolean;
  onDelete?: () => void;
  dragging?: boolean;
}) {
  return (
    <Card className={`p-3 ${dragging ? "shadow-lg ring-2 ring-accent" : ""}`}>
      <div className="flex items-start gap-2">
        {handleProps && (
          <button
            {...handleProps}
            className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground"
            aria-label="Déplacer"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{task.title}</p>
            <Badge className={PRIORITY_COLORS[task.priority]}>
              <Flag className="mr-1 h-3 w-3" />
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <UserIcon className="h-3 w-3" /> {userName(task.assigned_to)}
            </span>
            {task.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(task.due_date).toLocaleDateString("fr-FR")}
              </span>
            )}
          </div>
          {canManage && onDelete && (
            <div className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-destructive"
                onClick={onDelete}
              >
                Supprimer
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function NewTaskDialog({
  projects,
  profiles,
  onDone,
  userId,
}: {
  projects: { id: string; name: string }[];
  profiles: { id: string; full_name: string | null; email: string }[];
  onDone: () => void;
  userId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: "",
    description: "",
    project_id: "",
    assigned_to: "",
    priority: "normale" as Priority,
    due_date: "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      const parsed = z
        .object({
          title: z.string().trim().min(2).max(200),
          description: z.string().trim().max(2000).optional(),
        })
        .safeParse({ title: form.title, description: form.description });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const { error } = await supabase.from("tasks").insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        project_id: form.project_id || null,
        assigned_to: form.assigned_to || null,
        priority: form.priority,
        due_date: form.due_date || null,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tâche créée");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Nouvelle tâche</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
        className="space-y-3"
      >
        <div>
          <Label className="text-xs">Titre *</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Projet</Label>
            <Select
              value={form.project_id || "none"}
              onValueChange={(v) => setForm({ ...form, project_id: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Assigné à</Label>
            <Select
              value={form.assigned_to || "none"}
              onValueChange={(v) => setForm({ ...form, assigned_to: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Personne</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name ?? p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Priorité</Label>
            <Select
              value={form.priority}
              onValueChange={(v) => setForm({ ...form, priority: v as Priority })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Échéance</Label>
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Annuler
          </Button>
          <Button type="submit" disabled={mut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
            {mut.isPending ? "Création…" : "Créer la tâche"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
