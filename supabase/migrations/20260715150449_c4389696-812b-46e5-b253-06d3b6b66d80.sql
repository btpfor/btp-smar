
-- =========================================
-- PHASE 1 — Fondations stockage GECO/Synology
-- =========================================

-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.document_category AS ENUM (
    'ADMINISTRATIF','CONTRATS','DEVIS','FACTURES','PLANS',
    'RAPPORTS','PHOTOS','PV','AUTRES'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.document_status AS ENUM (
    'ACTIVE','ARCHIVED','SOFT_DELETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.storage_status AS ENUM (
    'PENDING_STORAGE','UPLOADING','STORED','STORAGE_FAILED','ARCHIVED','UNAVAILABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.file_job_type AS ENUM (
    'UPLOAD_FILE','READ_FILE','CREATE_DIRECTORY','MOVE_FILE','RENAME_FILE',
    'ARCHIVE_FILE','DELETE_FILE','HEALTH_CHECK','CALCULATE_CHECKSUM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.file_job_status AS ENUM (
    'PENDING','CLAIMED','RUNNING','COMPLETED','FAILED','RETRY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================
-- documents (entité logique)
-- =========================================
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  category public.document_category NOT NULL DEFAULT 'AUTRES',
  name text NOT NULL,
  description text,
  mime_type text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  current_version_id uuid,
  status public.document_status NOT NULL DEFAULT 'ACTIVE',
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON public.documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON public.documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON public.documents FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR owner_id = auth.uid()
  OR (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
);
CREATE POLICY "documents_insert" ON public.documents FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid() AND (
    public.has_role(auth.uid(),'admin')
    OR project_id IS NULL
    OR public.is_project_member(auth.uid(), project_id)
  )
);
CREATE POLICY "documents_update" ON public.documents FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR owner_id = auth.uid()
  OR (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
);
CREATE POLICY "documents_delete" ON public.documents FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR owner_id = auth.uid());

CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- document_versions
-- =========================================
CREATE TABLE IF NOT EXISTS public.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  physical_name text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  mime_type text,
  checksum_sha256 text,
  synology_relative_path text,
  transit_storage_key text, -- clef Supabase Storage (bucket 'documents') pour transit
  storage_status public.storage_status NOT NULL DEFAULT 'PENDING_STORAGE',
  storage_error text,
  gateway_id text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_docver_document ON public.document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_docver_status ON public.document_versions(storage_status);
CREATE INDEX IF NOT EXISTS idx_docver_checksum ON public.document_versions(checksum_sha256);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_versions TO authenticated;
GRANT ALL ON public.document_versions TO service_role;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docver_select" ON public.document_versions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND (
  public.has_role(auth.uid(),'admin')
  OR d.owner_id = auth.uid()
  OR (d.project_id IS NOT NULL AND public.is_project_member(auth.uid(), d.project_id))
)));
CREATE POLICY "docver_insert" ON public.document_versions FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND (
    public.has_role(auth.uid(),'admin')
    OR d.owner_id = auth.uid()
    OR (d.project_id IS NOT NULL AND public.is_project_member(auth.uid(), d.project_id))
  ))
);
CREATE POLICY "docver_update_admin" ON public.document_versions FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_docver_updated_at
BEFORE UPDATE ON public.document_versions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FK courante (déclarée après création table versions)
ALTER TABLE public.documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.document_versions(id) ON DELETE SET NULL;

-- =========================================
-- file_jobs
-- =========================================
CREATE TABLE IF NOT EXISTS public.file_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.file_job_type NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  gateway_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, -- jamais de secret SMB
  status public.file_job_status NOT NULL DEFAULT 'PENDING',
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  error text,
  transit_storage_key text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  next_retry_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.file_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON public.file_jobs(type,status);
CREATE INDEX IF NOT EXISTS idx_jobs_document ON public.file_jobs(document_id);

GRANT SELECT, INSERT, UPDATE ON public.file_jobs TO authenticated;
GRANT ALL ON public.file_jobs TO service_role;
ALTER TABLE public.file_jobs ENABLE ROW LEVEL SECURITY;

-- Lecture: admin ou membre du projet lié
CREATE POLICY "jobs_select" ON public.file_jobs FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
  OR created_by = auth.uid()
);
-- Insertion: seulement admin (les insertions applicatives passent par server functions service_role)
CREATE POLICY "jobs_insert_admin" ON public.file_jobs FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin'));
-- Update: admin uniquement (le Gateway utilise service_role côté serveur)
CREATE POLICY "jobs_update_admin" ON public.file_jobs FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON public.file_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- document_audit
-- =========================================
CREATE TABLE IF NOT EXISTS public.document_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  gateway_id text,
  action text NOT NULL,
  request_id text,
  result text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_docaudit_doc ON public.document_audit(document_id);
CREATE INDEX IF NOT EXISTS idx_docaudit_user ON public.document_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_docaudit_created ON public.document_audit(created_at DESC);

GRANT SELECT, INSERT ON public.document_audit TO authenticated;
GRANT ALL ON public.document_audit TO service_role;
ALTER TABLE public.document_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docaudit_select_admin" ON public.document_audit FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid());
CREATE POLICY "docaudit_insert" ON public.document_audit FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- =========================================
-- Helper: garantir un dossier de projet
-- =========================================
CREATE OR REPLACE FUNCTION public.project_storage_prefix(_project_id uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 'GECO/PROJETS/' || COALESCE(
    (SELECT 'PRJ-' || lpad(substr(replace(id::text,'-',''),1,8),8,'0') FROM public.projects WHERE id = _project_id),
    'UNASSIGNED'
  );
$$;
