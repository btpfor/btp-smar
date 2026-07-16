import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
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
  CheckCircle2,
  XCircle,
  SkipForward,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  DialogDescription,
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

type DuplicateAction = "replace" | "skip" | "keep-both";
type ImportProgress = {
  total: number;
  done: number;
  currentFile: string;
  succeeded: { name: string; path: string }[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
};

function DocumentsPage() {
  const { folder: folderId, project: projectId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canManageProjects, isAdmin } = useRoles();
  const canManage = canManageProjects || isAdmin;
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Import state
  const [importState, setImportState] = useState<ImportProgress | null>(null);
  const [importFinished, setImportFinished] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>("keep-both");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [applyToAllDuplicates, setApplyToAllDuplicates] = useState(true);

  // Duplicate prompt state
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    fileName: string;
    resolve: (action: DuplicateAction | "cancel") => void;
  } | null>(null);

  // Pre-import options dialog
  const [optionsDialog, setOptionsDialog] = useState<{
    files: File[];
  } | null>(null);

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

  const uploadSingleFile = async (
    file: File,
    targetFolderId: string | null,
    fileName: string,
  ): Promise<void> => {
    if (file.size > MAX_BYTES) {
      throw new Error(`Fichier trop volumineux (max 500 MB)`);
    }
    const path = `${projectId ?? "global"}/${targetFolderId ?? "root"}/${Date.now()}-${fileName}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) throw new Error(upErr.message);
    const { error } = await supabase.from("files").insert({
      name: fileName,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      folder_id: targetFolderId,
      project_id: projectId ?? null,
      uploaded_by: user?.id,
    });
    if (error) throw new Error(error.message);
  };

  // Simple single-file upload (Importer button)
  const uploadFile = async (file: File) => {
    try {
      await uploadSingleFile(file, folderId ?? null, file.name);
      toast.success("Fichier ajouté");
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const findExistingFile = async (name: string, targetFolderId: string | null) => {
    let q = supabase.from("files").select("id,storage_path").eq("name", name);
    q = targetFolderId ? q.eq("folder_id", targetFolderId) : q.is("folder_id", null);
    q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
    const { data } = await q.maybeSingle();
    return data;
  };

  const askDuplicate = (fileName: string): Promise<DuplicateAction | "cancel"> =>
    new Promise((resolve) => setDuplicatePrompt({ fileName, resolve }));

  const runImport = async (rawFiles: File[], subfolders: boolean) => {
    const files = subfolders
      ? rawFiles
      : rawFiles.filter((f) => {
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          const parts = rel.split("/").filter(Boolean);
          return parts.length <= 2; // root/file only (1 level = "folder/file.ext")
        });

    if (files.length === 0) {
      toast.error("Aucun fichier à importer");
      return;
    }

    const cache = new Map<string, string | null>();
    cache.set("", folderId ?? null);

    const ensureFolder = async (segments: string[]): Promise<string | null> => {
      const key = segments.join("/");
      if (cache.has(key)) return cache.get(key)!;
      const parent = await ensureFolder(segments.slice(0, -1));
      const name = segments[segments.length - 1];
      let query = supabase.from("folders").select("id").eq("name", name);
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

    const state: ImportProgress = {
      total: files.length,
      done: 0,
      currentFile: "",
      succeeded: [],
      skipped: [],
      failed: [],
    };
    setImportState({ ...state });
    setImportFinished(false);

    let globalDuplicateAction: DuplicateAction | null = applyToAllDuplicates
      ? duplicateAction
      : null;

    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split("/").filter(Boolean);
      const folderSegments = subfolders ? parts.slice(0, -1) : parts.slice(0, 1).length > 1 ? parts.slice(0, 1) : [];
      // When not including subfolders, keep only the root folder wrapping (if any)
      const effectiveSegments = subfolders ? parts.slice(0, -1) : parts.length > 1 ? [parts[0]] : [];
      const displayName = parts[parts.length - 1];
      state.currentFile = rel;
      setImportState({ ...state });

      try {
        const target = await ensureFolder(effectiveSegments);
        const existing = await findExistingFile(displayName, target);

        let finalName = displayName;
        let action: DuplicateAction = "keep-both";

        if (existing) {
          action = globalDuplicateAction ?? (await askDuplicate(displayName) as DuplicateAction);
          if ((action as DuplicateAction | "cancel") === "cancel") {
            state.skipped.push({ name: rel, reason: "Import annulé" });
            state.done += 1;
            setImportState({ ...state });
            continue;
          }

          if (action === "skip") {
            state.skipped.push({ name: rel, reason: "Doublon ignoré" });
            state.done += 1;
            setImportState({ ...state });
            continue;
          }

          if (action === "replace") {
            await supabase.storage.from("documents").remove([existing.storage_path]).catch(() => {});
            await supabase.from("files").delete().eq("id", existing.id);
          }

          if (action === "keep-both") {
            const dot = displayName.lastIndexOf(".");
            const base = dot > 0 ? displayName.slice(0, dot) : displayName;
            const ext = dot > 0 ? displayName.slice(dot) : "";
            finalName = `${base} (${Date.now().toString().slice(-4)})${ext}`;
          }
        }

        await uploadSingleFile(f, target, finalName);
        state.succeeded.push({ name: rel, path: finalName });
      } catch (e) {
        state.failed.push({ name: rel, reason: (e as Error).message });
      }

      state.done += 1;
      setImportState({ ...state });
      // avoid unused var warning
      void folderSegments;
    }

    setImportFinished(true);
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["files"] });
  };

  // Drag & drop handlers
  const traverseEntry = async (entry: FileSystemEntry, path = ""): Promise<File[]> => {
    if (entry.isFile) {
      return new Promise((resolve, reject) => {
        (entry as FileSystemFileEntry).file(
          (file) => {
            const relativePath = path + file.name;
            Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
            resolve([file]);
          },
          (err) => reject(err),
        );
      });
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const entries: FileSystemEntry[] = [];
      const readAll = () =>
        new Promise<void>((resolve, reject) => {
          const readBatch = () => {
            reader.readEntries((batch) => {
              if (batch.length === 0) return resolve();
              entries.push(...batch);
              readBatch();
            }, reject);
          };
          readBatch();
        });
      await readAll();
      const all: File[] = [];
      for (const e of entries) {
        const sub = await traverseEntry(e, path + entry.name + "/");
        all.push(...sub);
      }
      return all;
    }
    return [];
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      if (!canManage && !user) return;

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      const collected: File[] = [];
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const entry = it.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      const hasDirectory = entries.some((en) => en.isDirectory);

      for (const en of entries) {
        try {
          const list = await traverseEntry(en);
          collected.push(...list);
        } catch {
          // ignore
        }
      }

      if (collected.length === 0) return;

      if (hasDirectory) {
        setOptionsDialog({ files: collected });
      } else {
        await runImport(collected, true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folderId, projectId, duplicateAction, applyToAllDuplicates],
  );

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

  const progressPct = importState
    ? Math.round((importState.done / Math.max(importState.total, 1)) * 100)
    : 0;

  return (
    <div
      className="relative space-y-6"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-accent bg-background p-8 text-center shadow-lg">
            <Upload className="mx-auto mb-3 h-10 w-10 text-accent" />
            <p className="text-lg font-semibold">Déposez ici pour importer</p>
            <p className="text-sm text-muted-foreground">Fichiers ou dossiers acceptés</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Glissez-déposez fichiers ou dossiers, ou utilisez les boutons ci-dessous
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
          <input
            ref={folderInput}
            type="file"
            className="hidden"
            // @ts-expect-error non-standard attributes for folder picker
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                setOptionsDialog({ files: Array.from(e.target.files) });
              }
              e.target.value = "";
            }}
          />
          <Button
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" /> Importer
          </Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()}>
            <FolderPlus className="mr-2 h-4 w-4" /> Importer dossier
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
          Ce dossier est vide. Glissez-déposez des fichiers ou dossiers ici.
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

      {/* Pre-import options dialog */}
      <Dialog
        open={!!optionsDialog}
        onOpenChange={(open) => {
          if (!open) setOptionsDialog(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Options d'import</DialogTitle>
            <DialogDescription>
              {optionsDialog?.files.length ?? 0} élément(s) sélectionné(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold">Sous-dossiers</Label>
              <RadioGroup
                value={includeSubfolders ? "all" : "root"}
                onValueChange={(v) => setIncludeSubfolders(v === "all")}
                className="mt-2 space-y-1"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="all" /> Importer avec les sous-dossiers
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="root" /> Uniquement le dossier racine
                </label>
              </RadioGroup>
            </div>
            <div>
              <Label className="text-xs font-semibold">En cas de doublon</Label>
              <RadioGroup
                value={duplicateAction}
                onValueChange={(v) => setDuplicateAction(v as DuplicateAction)}
                className="mt-2 space-y-1"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="replace" /> Remplacer l'existant
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="skip" /> Ignorer le nouveau
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="keep-both" /> Conserver les deux versions
                </label>
              </RadioGroup>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={applyToAllDuplicates}
                  onCheckedChange={(c) => setApplyToAllDuplicates(!!c)}
                />
                Appliquer à tous les doublons sans redemander
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOptionsDialog(null)}>
              Annuler
            </Button>
            <Button
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              onClick={() => {
                const list = optionsDialog?.files ?? [];
                setOptionsDialog(null);
                runImport(list, includeSubfolders);
              }}
            >
              Lancer l'import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress dialog */}
      <Dialog
        open={!!importState}
        onOpenChange={(open) => {
          if (!open && importFinished) {
            setImportState(null);
            setImportFinished(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {importFinished ? "Import terminé" : "Import en cours…"}
            </DialogTitle>
            <DialogDescription>
              {importState?.done ?? 0} / {importState?.total ?? 0} fichier(s) traité(s)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Progress value={progressPct} />
            {!importFinished && importState?.currentFile && (
              <p className="truncate text-xs text-muted-foreground">
                En cours : {importState.currentFile}
              </p>
            )}
            {importFinished && importState && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg border p-2">
                    <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                    <div className="mt-1 font-semibold">{importState.succeeded.length}</div>
                    <div className="text-[10px] text-muted-foreground">Réussis</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <SkipForward className="mx-auto h-4 w-4 text-amber-600" />
                    <div className="mt-1 font-semibold">{importState.skipped.length}</div>
                    <div className="text-[10px] text-muted-foreground">Ignorés</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <XCircle className="mx-auto h-4 w-4 text-destructive" />
                    <div className="mt-1 font-semibold">{importState.failed.length}</div>
                    <div className="text-[10px] text-muted-foreground">Échecs</div>
                  </div>
                </div>

                {(importState.failed.length > 0 || importState.skipped.length > 0) && (
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2 text-xs">
                    {importState.failed.map((f, i) => (
                      <div key={`f${i}`} className="flex items-start gap-2">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{f.name}</p>
                          <p className="text-muted-foreground">{f.reason}</p>
                        </div>
                      </div>
                    ))}
                    {importState.skipped.map((f, i) => (
                      <div key={`s${i}`} className="flex items-start gap-2">
                        <SkipForward className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{f.name}</p>
                          <p className="text-muted-foreground">{f.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {importFinished && (
            <DialogFooter>
              <Button
                onClick={() => {
                  setImportState(null);
                  setImportFinished(false);
                }}
              >
                Fermer
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Duplicate prompt dialog */}
      <Dialog
        open={!!duplicatePrompt}
        onOpenChange={(open) => {
          if (!open && duplicatePrompt) {
            duplicatePrompt.resolve("cancel");
            setDuplicatePrompt(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fichier existant</DialogTitle>
            <DialogDescription className="break-all">
              « {duplicatePrompt?.fileName} » existe déjà. Que faire ?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => {
                duplicatePrompt?.resolve("replace");
                setDuplicatePrompt(null);
              }}
            >
              Remplacer
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                duplicatePrompt?.resolve("skip");
                setDuplicatePrompt(null);
              }}
            >
              Ignorer
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                duplicatePrompt?.resolve("keep-both");
                setDuplicatePrompt(null);
              }}
            >
              Conserver les deux
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
            Sélectionnez les profils autorisés. Sans sélection, seuls les administrateurs,
            chefs de projet et membres du projet pourront voir ce dossier — jamais tous les
            utilisateurs authentifiés.
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
