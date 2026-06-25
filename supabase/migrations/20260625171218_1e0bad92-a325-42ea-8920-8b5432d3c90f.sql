
-- Helper: check if user has any of the given roles
CREATE OR REPLACE FUNCTION public.user_has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _roles IS NULL
      OR array_length(_roles, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = ANY(_roles)
      );
$$;

-- Add allowed_roles column to folders & files (NULL = all roles allowed)
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS allowed_roles app_role[];
ALTER TABLE public.files   ADD COLUMN IF NOT EXISTS allowed_roles app_role[];

-- Recursive check: folder visible if itself + every ancestor passes allowed_roles
CREATE OR REPLACE FUNCTION public.can_access_folder(_user_id uuid, _folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, allowed_roles FROM public.folders WHERE id = _folder_id
    UNION ALL
    SELECT f.id, f.parent_id, f.allowed_roles
    FROM public.folders f
    JOIN chain c ON f.id = c.parent_id
  )
  SELECT public.has_role(_user_id, 'admin')
      OR NOT EXISTS (
        SELECT 1 FROM chain
        WHERE allowed_roles IS NOT NULL
          AND array_length(allowed_roles, 1) IS NOT NULL
          AND NOT public.user_has_any_role(_user_id, allowed_roles)
      );
$$;

-- Replace folders SELECT policy
DROP POLICY IF EXISTS "Read folders" ON public.folders;
CREATE POLICY "Read folders" ON public.folders
FOR SELECT TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin')
   OR public.has_role(auth.uid(), 'chef_projet')
   OR project_id IS NULL
   OR public.is_project_member(auth.uid(), project_id))
  AND public.can_access_folder(auth.uid(), id)
);

-- Replace files SELECT policy: enforce file allowed_roles + parent folder access
DROP POLICY IF EXISTS "Read files" ON public.files;
CREATE POLICY "Read files" ON public.files
FOR SELECT TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin')
   OR public.has_role(auth.uid(), 'chef_projet')
   OR project_id IS NULL
   OR public.is_project_member(auth.uid(), project_id))
  AND public.user_has_any_role(auth.uid(), allowed_roles)
  AND (folder_id IS NULL OR public.can_access_folder(auth.uid(), folder_id))
);
