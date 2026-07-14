
CREATE TYPE public.sync_job_status AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED','CONFLICT');
CREATE TYPE public.sync_job_operation AS ENUM (
  'CREATE_FOLDER','CREATE_PROJECT_STRUCTURE','UPLOAD_FILE','DOWNLOAD_FILE',
  'RENAME_FILE','MOVE_FILE','DELETE_FILE','RESTORE_FILE',
  'CALCULATE_CHECKSUM','SCAN_FOLDER','SYNC_METADATA'
);

CREATE TABLE public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL,
  operation public.sync_job_operation NOT NULL,
  source_path TEXT,
  destination_path TEXT,
  file_id UUID,
  project_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.sync_job_status NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_sync_jobs_status ON public.sync_jobs(status, created_at);
CREATE INDEX idx_sync_jobs_connector ON public.sync_jobs(connector_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_jobs TO authenticated;
GRANT ALL ON public.sync_jobs TO service_role;
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sync_jobs" ON public.sync_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.gateway_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id TEXT NOT NULL UNIQUE,
  gateway_version TEXT,
  nas_host TEXT,
  nas_reachable BOOLEAN NOT NULL DEFAULT false,
  smb_connected BOOLEAN NOT NULL DEFAULT false,
  total_bytes BIGINT,
  used_bytes BIGINT,
  available_bytes BIGINT,
  pending_jobs INT NOT NULL DEFAULT 0,
  failed_jobs INT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gateway_heartbeats TO authenticated;
GRANT ALL ON public.gateway_heartbeats TO service_role;
ALTER TABLE public.gateway_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read gateway_heartbeats" ON public.gateway_heartbeats
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
