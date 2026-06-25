
-- ENUMS
CREATE TYPE public.task_priority AS ENUM ('basse','normale','haute','urgente');
CREATE TYPE public.task_status AS ENUM ('a_faire','en_cours','termine');
CREATE TYPE public.notification_type AS ENUM ('document','tache','projet','rapport');

-- FOLDERS
CREATE TABLE public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read folders" ON public.folders FOR SELECT TO authenticated
USING (
  project_id IS NULL
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'chef_projet')
  OR public.is_project_member(auth.uid(), project_id)
);
CREATE POLICY "Manage folders admin" ON public.folders FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet'));

CREATE TRIGGER trg_folders_updated BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FILES
CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid REFERENCES public.folders(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.files TO authenticated;
GRANT ALL ON public.files TO service_role;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read files" ON public.files FOR SELECT TO authenticated
USING (
  project_id IS NULL
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'chef_projet')
  OR public.is_project_member(auth.uid(), project_id)
);
CREATE POLICY "Upload files" ON public.files FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid() AND (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'chef_projet')
    OR public.has_role(auth.uid(),'ingenieur')
  )
);
CREATE POLICY "Delete files admin" ON public.files FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet') OR uploaded_by = auth.uid());

-- TASKS
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES auth.users(id),
  priority public.task_priority NOT NULL DEFAULT 'normale',
  due_date date,
  status public.task_status NOT NULL DEFAULT 'a_faire',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read tasks" ON public.tasks FOR SELECT TO authenticated
USING (
  assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'chef_projet')
  OR (project_id IS NOT NULL AND public.is_project_member(auth.uid(), project_id))
);
CREATE POLICY "Manage tasks admin" ON public.tasks FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet'));
CREATE POLICY "Assignee updates status" ON public.tasks FOR UPDATE TO authenticated
USING (assigned_to = auth.uid()) WITH CHECK (assigned_to = auth.uid());

CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title text NOT NULL,
  message text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own notifications" ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "Update own notifications" ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Insert notifications" ON public.notifications FOR INSERT TO authenticated
WITH CHECK (true);
CREATE POLICY "Delete own notifications" ON public.notifications FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- Helper to notify project members
CREATE OR REPLACE FUNCTION public.notify_project_members(
  _project_id uuid, _type public.notification_type, _title text, _message text, _link text, _exclude uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id, type, title, message, link)
  SELECT DISTINCT u, _type, _title, _message, _link FROM (
    SELECT manager_id AS u FROM public.projects WHERE id = _project_id AND manager_id IS NOT NULL
    UNION SELECT client_id FROM public.projects WHERE id = _project_id AND client_id IS NOT NULL
    UNION SELECT created_by FROM public.projects WHERE id = _project_id AND created_by IS NOT NULL
    UNION SELECT user_id FROM public.project_members WHERE project_id = _project_id
  ) s WHERE u IS NOT NULL AND (_exclude IS NULL OR u <> _exclude);
END;$$;

-- Triggers for notifications
CREATE OR REPLACE FUNCTION public.notify_on_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    PERFORM public.notify_project_members(NEW.project_id,'document','Nouveau document',
      'Le fichier "' || NEW.name || '" a été ajouté','/documents', NEW.uploaded_by);
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_notify_file AFTER INSERT ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_file();

CREATE OR REPLACE FUNCTION public.notify_on_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> COALESCE(NEW.created_by,'00000000-0000-0000-0000-000000000000'::uuid) THEN
    INSERT INTO public.notifications(user_id,type,title,message,link)
    VALUES(NEW.assigned_to,'tache','Nouvelle tâche assignée', NEW.title,'/tasks');
  ELSIF TG_OP='UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,type,title,message,link)
    VALUES(NEW.assigned_to,'tache','Tâche assignée', NEW.title,'/tasks');
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_notify_task AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_task();

CREATE OR REPLACE FUNCTION public.notify_on_project_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.progress IS DISTINCT FROM OLD.progress THEN
    PERFORM public.notify_project_members(NEW.id,'projet','Projet mis à jour',
      'Le projet "' || NEW.name || '" a été modifié','/projects/'||NEW.id, auth.uid());
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_notify_project AFTER UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_project_update();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.files;

-- Storage policies for documents bucket (bucket created via tool)
CREATE POLICY "Read documents" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='documents');
CREATE POLICY "Upload documents" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='documents' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet') OR public.has_role(auth.uid(),'ingenieur')
));
CREATE POLICY "Delete documents" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='documents' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'chef_projet') OR owner = auth.uid()
));
