import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type DocCategory = Database["public"]["Enums"]["document_category"];
type DocStatus = Database["public"]["Enums"]["document_status"];
type StorageStatus = Database["public"]["Enums"]["storage_status"];

const TRANSIT_BUCKET = "documents";
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_MIME_PREFIXES = [
  "application/",
  "image/",
  "text/",
  "audio/",
  "video/",
];

/** Vérifie que l'utilisateur peut agir sur un projet (membre, manager, client, créateur ou admin). */
async function assertProjectAccess(
  supabase: Awaited<ReturnType<typeof requireSupabaseAuth["_options"]["server"]>>["context"]["supabase"],
  userId: string,
  projectId: string | null | undefined,
) {
  if (!projectId) return; // document non rattaché : le porteur assume la responsabilité
  const { data, error } = await supabase.rpc("is_project_member", {
    _user_id: userId,
    _project_id: projectId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("FORBIDDEN_PROJECT");
}

async function isAdmin(
  supabase: Parameters<typeof assertProjectAccess>[0],
  userId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return Boolean(data);
}

async function audit(params: {
  userId: string;
  documentId?: string | null;
  documentVersionId?: string | null;
  projectId?: string | null;
  action: string;
  result?: string;
  metadata?: Record<string, unknown>;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("document_audit").insert({
    user_id: params.userId,
    document_id: params.documentId ?? null,
    document_version_id: params.documentVersionId ?? null,
    project_id: params.projectId ?? null,
    action: params.action,
    result: params.result ?? null,
    metadata: (params.metadata ?? {}) as never,
  });
}

// ============================================================
// LIST
// ============================================================
export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: unknown) =>
      (data ?? {}) as {
        projectId?: string;
        category?: DocCategory;
        status?: DocStatus;
        search?: string;
        limit?: number;
        offset?: number;
      },
  )
  .handler(async ({ data, context }) => {
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 200);
    const offset = Math.max(data.offset ?? 0, 0);

    let q = context.supabase
      .from("documents")
      .select(
        "id,name,category,mime_type,status,project_id,folder_id,owner_id,current_version_id,created_at,updated_at",
      )
      .neq("status", "SOFT_DELETED")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.category) q = q.eq("category", data.category);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) q = q.ilike("name", `%${data.search}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    if (!rows || rows.length === 0) return [];

    // Fetch current versions in a batch
    const versionIds = rows.map((r) => r.current_version_id).filter(Boolean) as string[];
    let versions: Record<string, {
      id: string;
      version_number: number;
      size: number;
      storage_status: StorageStatus;
      stored_at: string | null;
      checksum_sha256: string | null;
    }> = {};
    if (versionIds.length > 0) {
      const { data: vs } = await context.supabase
        .from("document_versions")
        .select("id,version_number,size,storage_status,stored_at,checksum_sha256")
        .in("id", versionIds);
      for (const v of vs ?? []) versions[v.id] = v;
    }

    return rows.map((r) => ({
      ...r,
      currentVersion: r.current_version_id ? versions[r.current_version_id] ?? null : null,
    }));
  });

// ============================================================
// GET (with versions history)
// ============================================================
export const getDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { documentId: string })
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase
      .from("documents")
      .select("*")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("NOT_FOUND");

    const { data: versions } = await context.supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", data.documentId)
      .order("version_number", { ascending: false });

    return { document: doc, versions: versions ?? [] };
  });

// ============================================================
// UPLOAD — étape 1 : ticket signé pour envoyer vers le transit
// ============================================================
export const createUploadTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: unknown) =>
      data as {
        projectId?: string | null;
        folderId?: string | null;
        category?: DocCategory;
        name: string;
        mimeType: string;
        size: number;
        // Pour nouvelle version d'un document existant
        documentId?: string | null;
      },
  )
  .handler(async ({ data, context }) => {
    // Validation basique
    if (!data.name || data.name.length > 512) throw new Error("INVALID_NAME");
    if (!data.mimeType || !ALLOWED_MIME_PREFIXES.some((p) => data.mimeType.startsWith(p))) {
      throw new Error("INVALID_MIME");
    }
    if (data.size <= 0 || data.size > MAX_FILE_SIZE) throw new Error("INVALID_SIZE");

    let document: { id: string; project_id: string | null } | null = null;
    let versionNumber = 1;

    if (data.documentId) {
      // Nouvelle version
      const { data: existing } = await context.supabase
        .from("documents")
        .select("id,project_id,owner_id")
        .eq("id", data.documentId)
        .maybeSingle();
      if (!existing) throw new Error("DOCUMENT_NOT_FOUND");
      await assertProjectAccess(context.supabase, context.userId, existing.project_id);
      document = { id: existing.id, project_id: existing.project_id };
      const { data: last } = await context.supabase
        .from("document_versions")
        .select("version_number")
        .eq("document_id", existing.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      versionNumber = (last?.version_number ?? 0) + 1;
    } else {
      // Nouveau document
      await assertProjectAccess(context.supabase, context.userId, data.projectId ?? null);
      const { data: created, error: insErr } = await context.supabase
        .from("documents")
        .insert({
          project_id: data.projectId ?? null,
          folder_id: data.folderId ?? null,
          category: data.category ?? "AUTRES",
          name: data.name,
          mime_type: data.mimeType,
          owner_id: context.userId,
          created_by: context.userId,
          status: "ACTIVE",
        })
        .select("id,project_id")
        .single();
      if (insErr) throw new Error(insErr.message);
      document = created;
    }

    // Nom physique sécurisé + clef transit imprévisible
    const ext = data.name.includes(".") ? data.name.split(".").pop()!.toLowerCase().slice(0, 12) : "bin";
    const physical = `${document!.id}-v${versionNumber}-${crypto.randomUUID()}.${ext}`;
    const transitKey = `transit/${document!.id}/${physical}`;

    // Crée la version PENDING_STORAGE
    const { data: version, error: vErr } = await context.supabase
      .from("document_versions")
      .insert({
        document_id: document!.id,
        version_number: versionNumber,
        physical_name: physical,
        size: data.size,
        mime_type: data.mimeType,
        transit_storage_key: transitKey,
        storage_status: "PENDING_STORAGE",
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (vErr) throw new Error(vErr.message);

    // Génère l'URL signée d'upload vers le transit
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sigErr } = await supabaseAdmin.storage
      .from(TRANSIT_BUCKET)
      .createSignedUploadUrl(transitKey);
    if (sigErr) throw new Error(sigErr.message);

    await audit({
      userId: context.userId,
      documentId: document!.id,
      documentVersionId: version.id,
      projectId: document!.project_id,
      action: "DOCUMENT_UPLOAD_REQUESTED",
      metadata: { size: data.size, mime: data.mimeType, versionNumber },
    });

    return {
      documentId: document!.id,
      versionId: version.id,
      versionNumber,
      transitKey,
      uploadUrl: signed.signedUrl,
      uploadToken: signed.token,
      bucket: TRANSIT_BUCKET,
    };
  });

// ============================================================
// UPLOAD — étape 2 : confirmation post-upload transit → crée job Gateway
// ============================================================
export const confirmUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: unknown) =>
      data as {
        documentId: string;
        versionId: string;
        checksumSha256?: string | null;
      },
  )
  .handler(async ({ data, context }) => {
    // Vérifie ownership de la version
    const { data: version, error: vErr } = await context.supabase
      .from("document_versions")
      .select("id,document_id,version_number,transit_storage_key,storage_status")
      .eq("id", data.versionId)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!version || version.document_id !== data.documentId) throw new Error("VERSION_NOT_FOUND");
    if (version.storage_status !== "PENDING_STORAGE") {
      throw new Error(`INVALID_STATE:${version.storage_status}`);
    }

    const { data: doc } = await context.supabase
      .from("documents")
      .select("id,project_id,category,name")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    await assertProjectAccess(context.supabase, context.userId, doc.project_id);

    // Calcule le chemin Synology cible (préfixe stable par projet)
    let projectPrefix = "GECO/ENTREPRISE/AUTRES";
    if (doc.project_id) {
      const { data: prefix } = await context.supabase.rpc("project_storage_prefix", {
        _project_id: doc.project_id,
      });
      if (typeof prefix === "string") projectPrefix = prefix;
    }
    const synologyRelativePath = `${projectPrefix}/${doc.category}/${version.version_number}_${doc.name}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Marque la version en UPLOADING + chemin cible
    await supabaseAdmin
      .from("document_versions")
      .update({
        storage_status: "UPLOADING",
        synology_relative_path: synologyRelativePath,
        checksum_sha256: data.checksumSha256 ?? null,
      })
      .eq("id", version.id);

    // Rend cette version courante côté document logique
    await supabaseAdmin
      .from("documents")
      .update({ current_version_id: version.id })
      .eq("id", doc.id);

    // Crée le File Job UPLOAD_FILE (payload SANS secret SMB)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("file_jobs")
      .insert({
        type: "UPLOAD_FILE",
        document_id: doc.id,
        document_version_id: version.id,
        project_id: doc.project_id,
        transit_storage_key: version.transit_storage_key,
        payload: {
          transitBucket: TRANSIT_BUCKET,
          transitKey: version.transit_storage_key,
          synologyRelativePath,
          expectedChecksum: data.checksumSha256 ?? null,
          documentName: doc.name,
        } as never,
        status: "PENDING",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (jobErr) throw new Error(jobErr.message);

    await audit({
      userId: context.userId,
      documentId: doc.id,
      documentVersionId: version.id,
      projectId: doc.project_id,
      action: "DOCUMENT_STORAGE_REQUESTED",
      metadata: { jobId: job.id, path: synologyRelativePath },
    });

    return { jobId: job.id, synologyRelativePath };
  });

// ============================================================
// DOWNLOAD — crée un job READ_FILE OU renvoie une URL transit si dispo
// ============================================================
export const createDownloadTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: unknown) =>
      data as { documentId: string; versionId?: string | null },
  )
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase
      .from("documents")
      .select("id,project_id,current_version_id,name")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");

    const targetVersionId = data.versionId ?? doc.current_version_id;
    if (!targetVersionId) throw new Error("NO_VERSION");

    const { data: version } = await context.supabase
      .from("document_versions")
      .select("id,document_id,transit_storage_key,synology_relative_path,storage_status,mime_type")
      .eq("id", targetVersionId)
      .maybeSingle();
    if (!version || version.document_id !== doc.id) throw new Error("VERSION_NOT_FOUND");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Si le transit contient encore la version (fenêtre juste après upload), on sert directement.
    if (version.transit_storage_key) {
      const { data: signed } = await supabaseAdmin.storage
        .from(TRANSIT_BUCKET)
        .createSignedUrl(version.transit_storage_key, 60 * 5);
      if (signed?.signedUrl) {
        await audit({
          userId: context.userId,
          documentId: doc.id,
          documentVersionId: version.id,
          projectId: doc.project_id,
          action: "DOCUMENT_DOWNLOADED",
          result: "TRANSIT_HIT",
        });
        return { mode: "direct" as const, downloadUrl: signed.signedUrl, expiresIn: 300 };
      }
    }

    // Sinon : demander à la Gateway de relire le fichier depuis Synology vers transit.
    if (!version.synology_relative_path) throw new Error("NO_SYNOLOGY_PATH");
    const stagingKey = `staging/${doc.id}/${crypto.randomUUID()}`;

    const { data: job, error: jobErr } = await supabaseAdmin
      .from("file_jobs")
      .insert({
        type: "READ_FILE",
        document_id: doc.id,
        document_version_id: version.id,
        project_id: doc.project_id,
        transit_storage_key: stagingKey,
        payload: {
          synologyRelativePath: version.synology_relative_path,
          transitBucket: TRANSIT_BUCKET,
          transitKey: stagingKey,
        } as never,
        status: "PENDING",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (jobErr) throw new Error(jobErr.message);

    await audit({
      userId: context.userId,
      documentId: doc.id,
      documentVersionId: version.id,
      projectId: doc.project_id,
      action: "DOCUMENT_DOWNLOAD_REQUESTED",
      metadata: { jobId: job.id },
    });

    return { mode: "job" as const, jobId: job.id, stagingKey };
  });

// ============================================================
// Polling d'un job (utilisé par le download quand mode=job)
// ============================================================
export const getFileJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { jobId: string })
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("file_jobs")
      .select(
        "id,type,status,error,attempt_count,transit_storage_key,completed_at,document_id,document_version_id",
      )
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("JOB_NOT_FOUND");

    let downloadUrl: string | null = null;
    if (job.status === "COMPLETED" && job.type === "READ_FILE" && job.transit_storage_key) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: signed } = await supabaseAdmin.storage
        .from(TRANSIT_BUCKET)
        .createSignedUrl(job.transit_storage_key, 60 * 5);
      downloadUrl = signed?.signedUrl ?? null;
    }
    return { ...job, downloadUrl };
  });

// ============================================================
// LIST versions
// ============================================================
export const listVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { documentId: string })
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", data.documentId)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============================================================
// RENAME
// ============================================================
export const renameDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { documentId: string; name: string })
  .handler(async ({ data, context }) => {
    if (!data.name || data.name.length > 512) throw new Error("INVALID_NAME");
    const { data: doc } = await context.supabase
      .from("documents")
      .select("id,project_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    await assertProjectAccess(context.supabase, context.userId, doc.project_id);

    const { error } = await context.supabase
      .from("documents")
      .update({ name: data.name })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);

    await audit({
      userId: context.userId,
      documentId: doc.id,
      projectId: doc.project_id,
      action: "DOCUMENT_RENAMED",
      metadata: { newName: data.name },
    });
    return { ok: true };
  });

// ============================================================
// MOVE (change category / project / folder)
// ============================================================
export const moveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: unknown) =>
      data as {
        documentId: string;
        projectId?: string | null;
        folderId?: string | null;
        category?: DocCategory;
      },
  )
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase
      .from("documents")
      .select("id,project_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    await assertProjectAccess(context.supabase, context.userId, doc.project_id);
    if (data.projectId !== undefined) {
      await assertProjectAccess(context.supabase, context.userId, data.projectId);
    }

    const patch: Record<string, unknown> = {};
    if (data.projectId !== undefined) patch.project_id = data.projectId;
    if (data.folderId !== undefined) patch.folder_id = data.folderId;
    if (data.category) patch.category = data.category;

    const { error } = await context.supabase
      .from("documents")
      .update(patch)
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);

    await audit({
      userId: context.userId,
      documentId: doc.id,
      projectId: (data.projectId as string | undefined) ?? doc.project_id,
      action: "DOCUMENT_MOVED",
      metadata: patch,
    });
    return { ok: true };
  });

// ============================================================
// ARCHIVE (soft)
// ============================================================
export const archiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { documentId: string })
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase
      .from("documents")
      .select("id,project_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    await assertProjectAccess(context.supabase, context.userId, doc.project_id);

    const { error } = await context.supabase
      .from("documents")
      .update({ status: "ARCHIVED" as DocStatus })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);

    await audit({
      userId: context.userId,
      documentId: doc.id,
      projectId: doc.project_id,
      action: "DOCUMENT_ARCHIVED",
    });
    return { ok: true };
  });

// ============================================================
// SOFT DELETE
// ============================================================
export const softDeleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data as { documentId: string })
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase
      .from("documents")
      .select("id,project_id,owner_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    const admin = await isAdmin(context.supabase, context.userId);
    if (!admin && doc.owner_id !== context.userId) throw new Error("FORBIDDEN");

    const { error } = await context.supabase
      .from("documents")
      .update({
        status: "SOFT_DELETED" as DocStatus,
        deleted_at: new Date().toISOString(),
        deleted_by: context.userId,
      })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);

    await audit({
      userId: context.userId,
      documentId: doc.id,
      projectId: doc.project_id,
      action: "DOCUMENT_DELETE_REQUESTED",
    });
    return { ok: true };
  });
