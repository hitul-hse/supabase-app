CREATE OR REPLACE FUNCTION public.can_view_person(target_person_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    app_user_role() = 'exec'
    or (
      app_user_role() = 'dept_head'
      and exists (select 1 from people p where p.id = target_person_id and p.department = app_user_department())
    )
    or target_person_id = app_user_person_id();
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_project(target_project_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    app_user_role() = 'exec'
    or exists (
      select 1 from projects pr
      where pr.id = target_project_id
      and (
        (app_user_role() = 'dept_head' and pr.department = app_user_department())
        or pr.owner_person_id = app_user_person_id()
        or exists (
          select 1 from person_assignments pa
          where pa.project_id = pr.id and pa.person_id = app_user_person_id()
        )
      )
    );
$function$
;