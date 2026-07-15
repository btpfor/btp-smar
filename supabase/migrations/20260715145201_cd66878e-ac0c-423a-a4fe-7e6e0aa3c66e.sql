
CREATE TABLE public.synology_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 5000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.synology_configs TO authenticated;
GRANT ALL ON public.synology_configs TO service_role;

ALTER TABLE public.synology_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own synology configs"
  ON public.synology_configs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER synology_configs_updated_at
  BEFORE UPDATE ON public.synology_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
