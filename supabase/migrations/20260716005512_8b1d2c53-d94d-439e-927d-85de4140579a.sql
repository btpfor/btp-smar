
DROP POLICY IF EXISTS "Read folders" ON public.folders;
CREATE POLICY "Read folders" ON public.folders
FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'chef_projet'::app_role)
    OR project_id IS NULL
    OR public.is_project_member(auth.uid(), project_id)
  )
  AND public.can_access_folder(auth.uid(), id)
);

DROP POLICY IF EXISTS "Read files" ON public.files;
CREATE POLICY "Read files" ON public.files
FOR SELECT TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'chef_projet'::app_role)
    OR project_id IS NULL
    OR public.is_project_member(auth.uid(), project_id)
  )
  AND public.user_has_any_role(auth.uid(), allowed_roles)
  AND (folder_id IS NULL OR public.can_access_folder(auth.uid(), folder_id))
);
