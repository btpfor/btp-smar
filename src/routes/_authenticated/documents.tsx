import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Folder,
  FolderPlus,
  Upload,
  File as FileIcon,
  ChevronRight,
  Home,
  Download,
  Trash2,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRoles } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({ meta: [{ title: "Documents — Well Done Services" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    folder: typeof s.folder === "string" ? s.folder : undefined,
    project: typeof s.project === "string" ? s.project : undefined,
  }),
  component: DocumentsPage,
});

const MAX_BYTES = 500 * 1024 * 1024;

function DocumentsPage() {
  const { folder: folderId, project: projectId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canManageProjects, isAdmin } = useRoles();
  const canManage = canManageProjects || isAdmin;
  const fileInput = useRef<HTMLInputElement>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").order("name");
      return data ?? [];
    },
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["folders", projectId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("folders").select("*").order("name");
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const currentFolder = folders.find((f) => f.id === folderId) ?? null;
  const childFolders = folders.filter((f) =>
    folderId ? f.parent_id === folderId : f.parent_id === null,
  );

  const { data: files = [] } = useQuery({
    queryKey: ["files", folderId ?? "root", projectId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("files").select("*").order("created_at", { ascending: false });
      if (folderId) q = q.eq("folder_id", folderId);
      else q = q.is("folder_id", null);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  // breadcrumb
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "Racine" }];
  let cur = currentFolder;
  const stack: typeof crumbs = [];
  while (cur) {
    stack.unshift({ id: cur.id, name: cur.name });
    cur = folders.find((f) => f.id === cur!.parent_id) ?? null;
  }
  crumbs.push(...stack);

  const goTo = (fid?: string) =>
    navigate({ to: "/documents", search: { folder: fid, project: projectId } });

  const createFolder = useMutation({
    mutationFn: async (input: { name: string; allowedRoles: AppRole[] }) => {
      const parsed = z.string().trim().min(1).max(100).safeParse(input.name);
      if (!parsed.success) throw new Error("Nom invalide");
      const { error } = await supabase.from("folders").insert({
        name: parsed.data,
        parent_id: folderId ?? null,
        project_id: projectId ?? null,
        created_by: user?.id,
        allowed_roles: input.allowedRoles.length > 0 ? input.allowedRoles : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dossier créé");
      qc.invalidateQueries({ queryKey: ["folders"] });
      setNewFolderOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadFile = async (file: File, targetFolderId: string | null = folderId ?? null, silent = false) => {
    if (file.size > MAX_BYTES) {
      toast.error(`Fichier trop volumineux (max 500 MB) : ${file.name}`);
      return;
    }
    const path = `${projectId ?? "global"}/${targetFolderId ?? "root"}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) {
      toast.error(upErr.message);
      return;
    }
    const { error } = await supabase.from("files").insert({
      name: file.name,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      folder_id: targetFolderId,
      project_id: projectId ?? null,
      uploaded_by: user?.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!silent) toast.success("Fichier ajouté");
    qc.invalidateQueries({ queryKey: ["files"] });
  };

  const uploadFolder = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const cache = new Map<string, string | null>();
    cache.set("", folderId ?? null);

    const ensureFolder = async (segments: string[]): Promise<string | null> => {
      const key = segments.join("/");
      if (cache.has(key)) return cache.get(key)!;
      const parent = await ensureFolder(segments.slice(0, -1));
      const name = segments[segments.length - 1];
      let query = supabase
        .from("folders")
        .select("id")
        .eq("name", name);
      query = parent ? query.eq("parent_id", parent) : query.is("parent_id", null);
      query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);
      const { data: existing } = await query.maybeSingle();
      let id: string | null = existing?.id ?? null;
      if (!id) {
        const { data: inserted, error } = await supabase
          .from("folders")
          .insert({
            name,
            parent_id: parent,
            project_id: projectId ?? null,
            created_by: user?.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        id = inserted.id;
      }
      cache.set(key, id);
      return id;
    };

    const tId = toast.loading(`Import de ${files.length} fichier(s)…`);
    try {
      for (const f of files) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const parts = rel.split("/").filter(Boolean);
        const folderSegments = parts.slice(0, -1);
        const target = await ensureFolder(folderSegments);
        await uploadFile(f, target, true);
      }
      toast.success(`${files.length} fichier(s) importé(s)`, { id: tId });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      toast.error((e as Error).message, { id: tId });
    }
  };

  const download = async (path: string, name: string) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (error || !data) {
      toast.error("Téléchargement impossible");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = name;
    a.click();
  };

  const deleteFile = useMutation({
    mutationFn: async (f: { id: string; storage_path: string }) => {
      await supabase.storage.from("documents").remove([f.storage_path]);
      const { error } = await supabase.from("files").delete().eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fichier supprimé");
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Dossiers partagés — accès selon votre rôle et vos projets
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={projectId ?? "all"}
            onValueChange={(v) =>
              navigate({ to: "/documents", search: { project: v === "all" ? undefined : v, folder: undefined } })
            }
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Tous les projets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Espace global</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FolderPlus className="mr-2 h-4 w-4" /> Dossier
                </Button>
              </DialogTrigger>
              <NewFolderDialog onCreate={(name, allowedRoles) => createFolder.mutate({ name, allowedRoles })} pending={createFolder.isPending} />
            </Dialog>
          )}
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = "";
            }}
          />
          <Button
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" /> Importer
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.id ?? "root"} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <button
              onClick={() => goTo(c.id ?? undefined)}
              className="rounded px-2 py-1 hover:bg-muted"
            >
              {i === 0 ? <Home className="inline h-3 w-3" /> : null} {c.name}
            </button>
          </span>
        ))}
      </div>

      {childFolders.length === 0 && files.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Ce dossier est vide.
        </Card>
      ) : (
        <div className="space-y-6">
          {childFolders.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Dossiers</h2>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {childFolders.map((f) => {
                  const restricted: AppRole[] = (f as { allowed_roles?: AppRole[] | null }).allowed_roles ?? [];
                  return (
                    <button
                      key={f.id}
                      onClick={() => goTo(f.id)}
                      className="flex items-start gap-3 rounded-lg border bg-card p-4 text-left hover:border-accent hover:shadow-sm"
                    >
                      <Folder className="h-6 w-6 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-medium">{f.name}</span>
                          {restricted.length > 0 && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        {restricted.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {restricted.map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px]">
                                {ROLE_LABELS[r]}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {files.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Fichiers</h2>
              <Card>
                <ul className="divide-y">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 p-3 hover:bg-muted/30">
                      <FileIcon className="h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {((f.size_bytes ?? 0) / 1024).toFixed(1)} Ko ·{" "}
                          {new Date(f.created_at).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => download(f.storage_path, f.name)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      {(canManage || f.uploaded_by === user?.id) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("Supprimer ce fichier ?"))
                              deleteFile.mutate({ id: f.id, storage_path: f.storage_path });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function NewFolderDialog({
  onCreate,
  pending,
}: {
  onCreate: (name: string, allowedRoles: AppRole[]) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [allowed, setAllowed] = useState<AppRole[]>([]);
  const toggle = (r: AppRole) =>
    setAllowed((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Nouveau dossier</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name, allowed);
          setName("");
          setAllowed([]);
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="fn" className="text-xs">
            Nom du dossier
          </Label>
          <Input id="fn" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div>
          <Label className="text-xs">Accès limité aux rôles</Label>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Laissez tout décoché pour autoriser tous les membres du projet. Les administrateurs voient
            toujours tous les dossiers.
          </p>
          <div className="space-y-2">
            {(Object.keys(ROLE_LABELS) as AppRole[])
              .filter((r) => r !== "admin")
              .map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={allowed.includes(r)} onCheckedChange={() => toggle(r)} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
            Créer
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
