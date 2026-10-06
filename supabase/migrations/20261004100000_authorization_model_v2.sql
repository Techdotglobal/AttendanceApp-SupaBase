-- Additive authorization foundation.
-- Keeps users.role, users.department_id, and manager_permissions compatible
-- while adding organizational roles, multi-department assignments, and
-- scoped grants for all users.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS organization_role_id uuid,
  ADD COLUMN IF NOT EXISTS authorization_version bigint NOT NULL DEFAULT 1;

ALTER TABLE public.approval_workflow_steps
  ADD COLUMN IF NOT EXISTS required_permission_key text,
  ADD COLUMN IF NOT EXISTS required_scope_type text
    CHECK (required_scope_type IS NULL OR required_scope_type IN ('OWN', 'DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY')),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.organization_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, name)
);

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_organization_role_id_fkey;
ALTER TABLE public.users
  ADD CONSTRAINT users_organization_role_id_fkey
  FOREIGN KEY (organization_role_id) REFERENCES public.organization_roles(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.user_department_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_uid text NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_uid, department_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_department_assignments_one_primary
  ON public.user_department_assignments(user_uid)
  WHERE is_active = true AND is_primary = true;

CREATE INDEX IF NOT EXISTS user_department_assignments_company_idx
  ON public.user_department_assignments(company_id, department_id, user_uid)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  principal_uid text NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  scope_type text NOT NULL CHECK (scope_type IN ('OWN', 'DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY')),
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'delegated' CHECK (source IN ('legacy_manager', 'super_admin', 'delegated', 'system')),
  delegated_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_grants_scope_department_check CHECK (
    (scope_type = 'DEPARTMENT' AND department_id IS NOT NULL)
    OR (scope_type <> 'DEPARTMENT' AND department_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS permission_grants_identity_key
  ON public.permission_grants(
    principal_uid,
    permission_key,
    scope_type,
    COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS permission_grants_company_principal_idx
  ON public.permission_grants(company_id, principal_uid, granted);

CREATE TABLE IF NOT EXISTS public.authorization_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  target_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  action text NOT NULL,
  permission_key text,
  scope_type text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS authorization_audit_logs_company_created_idx
  ON public.authorization_audit_logs(company_id, created_at DESC);

-- Keep tenant ownership enforceable at the database boundary as well as in
-- the service layer. This prevents a malformed service-role write from
-- attaching a user, department, or grant to another company.
CREATE OR REPLACE FUNCTION public.enforce_user_department_assignment_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_company uuid;
  v_department_company uuid;
BEGIN
  SELECT company_id INTO v_user_company FROM public.users WHERE uid = NEW.user_uid;
  SELECT company_id INTO v_department_company FROM public.departments WHERE id = NEW.department_id;
  IF v_user_company IS NULL OR v_department_company IS NULL
     OR v_user_company IS DISTINCT FROM NEW.company_id
     OR v_department_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'department assignment must stay within the user company';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_department_assignment_company_guard ON public.user_department_assignments;
CREATE TRIGGER user_department_assignment_company_guard
BEFORE INSERT OR UPDATE ON public.user_department_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_user_department_assignment_company();

CREATE OR REPLACE FUNCTION public.enforce_permission_grant_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_company uuid;
  v_department_company uuid;
BEGIN
  SELECT company_id INTO v_user_company FROM public.users WHERE uid = NEW.principal_uid;
  IF v_user_company IS NULL OR v_user_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'permission grant must stay within the principal company';
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO v_department_company FROM public.departments WHERE id = NEW.department_id;
    IF v_department_company IS NULL OR v_department_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'permission grant department must stay within the principal company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS permission_grant_company_guard ON public.permission_grants;
CREATE TRIGGER permission_grant_company_guard
BEFORE INSERT OR UPDATE ON public.permission_grants
FOR EACH ROW EXECUTE FUNCTION public.enforce_permission_grant_company();

CREATE OR REPLACE FUNCTION public.enforce_user_organization_role_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_company uuid;
BEGIN
  IF NEW.organization_role_id IS NOT NULL THEN
    SELECT company_id INTO v_role_company
    FROM public.organization_roles
    WHERE id = NEW.organization_role_id;
    IF v_role_company IS NULL OR v_role_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'organizational role must stay within the user company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_organization_role_company_guard ON public.users;
CREATE TRIGGER user_organization_role_company_guard
BEFORE INSERT OR UPDATE OF organization_role_id, company_id ON public.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_user_organization_role_company();

-- Add new catalog keys without invalidating existing manager rows.
ALTER TABLE public.manager_permissions
  DROP CONSTRAINT IF EXISTS manager_permissions_known_key;
ALTER TABLE public.manager_permissions
  ADD CONSTRAINT manager_permissions_known_key CHECK (
    permission_key = ANY (ARRAY[
      'create_user','edit_user','delete_user','activate_user','deactivate_user',
      'change_user_role','assign_user_department','assign_user_permissions','view_employees',
      'manual_attendance','view_attendance','export_attendance','attendance_analytics',
      'view_leave_requests','create_leave_request','approve_leave','reject_leave','edit_leave_balance',
      'view_work_mode_requests','approve_work_mode','reject_work_mode',
      'view_tickets','manage_tickets','assign_tickets','close_tickets',
      'manage_geofencing','update_office_location','update_attendance_radius',
      'view_hr_dashboard','view_analytics','export_reports','view_reports',
      'create_events','edit_events','delete_events','manage_notifications',
      'approve_signup_requests','manage_departments','manage_approval_workflows',
      'manage_workflows','access_system_settings','view_payroll','manage_payroll'
    ])
  );

-- Backfill department assignments from the canonical UUID first, then the
-- legacy department text where older tenants were never normalized.
INSERT INTO public.user_department_assignments
  (company_id, user_uid, department_id, is_primary, is_active, assigned_by_uid)
SELECT u.company_id, u.uid, u.department_id, true, true, NULL
FROM public.users u
WHERE u.department_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = u.department_id AND d.company_id = u.company_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.user_department_assignments a
    WHERE a.user_uid = u.uid AND a.department_id = u.department_id
  );

INSERT INTO public.user_department_assignments
  (company_id, user_uid, department_id, is_primary, is_active, assigned_by_uid)
SELECT u.company_id, u.uid, d.id, true, true, NULL
FROM public.users u
JOIN public.departments d
  ON d.company_id = u.company_id
 AND lower(trim(d.name)) = lower(trim(u.department))
WHERE u.department_id IS NULL
  AND NULLIF(trim(u.department), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_department_assignments a
    WHERE a.user_uid = u.uid AND a.department_id = d.id
  );

-- Preserve existing manager behavior. Tenant-wide people permissions map to
-- COMPANY; other manager grants map to the manager's primary department.
INSERT INTO public.permission_grants
  (company_id, principal_uid, permission_key, granted, scope_type, department_id, source)
SELECT u.company_id,
       mp.manager_uid,
       mp.permission_key,
       mp.granted,
       CASE
         WHEN mp.permission_key IN (
           'view_employees','create_user','edit_user','delete_user',
           'activate_user','deactivate_user','change_user_role','approve_signup_requests'
         ) THEN 'COMPANY'
         WHEN COALESCE(u.department_id, a.department_id) IS NOT NULL THEN 'DEPARTMENT'
         ELSE 'COMPANY'
       END,
       CASE
         WHEN mp.permission_key IN (
           'view_employees','create_user','edit_user','delete_user',
           'activate_user','deactivate_user','change_user_role','approve_signup_requests'
         ) THEN NULL
         ELSE COALESCE(u.department_id, a.department_id)
       END,
       'legacy_manager'
FROM public.manager_permissions mp
JOIN public.users u ON u.uid = mp.manager_uid
LEFT JOIN LATERAL (
  SELECT department_id
  FROM public.user_department_assignments
  WHERE user_uid = u.uid AND is_active = true
  ORDER BY is_primary DESC, created_at ASC
  LIMIT 1
) a ON true
WHERE mp.granted = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.permission_grants pg
    WHERE pg.principal_uid = mp.manager_uid
      AND pg.permission_key = mp.permission_key
      AND pg.scope_type = CASE
        WHEN mp.permission_key IN (
          'view_employees','create_user','edit_user','delete_user',
          'activate_user','deactivate_user','change_user_role','approve_signup_requests'
        ) THEN 'COMPANY'
        WHEN COALESCE(u.department_id, a.department_id) IS NOT NULL THEN 'DEPARTMENT'
        ELSE 'COMPANY'
      END
      AND pg.department_id IS NOT DISTINCT FROM CASE
        WHEN mp.permission_key IN (
          'view_employees','create_user','edit_user','delete_user',
          'activate_user','deactivate_user','change_user_role','approve_signup_requests'
        ) THEN NULL
        ELSE COALESCE(u.department_id, a.department_id)
      END
  );

-- Keep the legacy projection synchronized when a primary assignment changes.
CREATE OR REPLACE FUNCTION public.sync_user_primary_department_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text := COALESCE(NEW.user_uid, OLD.user_uid);
  v_department_id uuid;
  v_department_name text;
BEGIN
  SELECT a.department_id, d.name
    INTO v_department_id, v_department_name
  FROM public.user_department_assignments a
  JOIN public.departments d ON d.id = a.department_id
  WHERE a.user_uid = v_uid AND a.is_active = true
  ORDER BY a.is_primary DESC, a.created_at ASC
  LIMIT 1;

  UPDATE public.users
  SET department_id = v_department_id,
      department = v_department_name,
      authorization_version = authorization_version + 1,
      updated_at = now()
  WHERE uid = v_uid;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_department_assignment_projection ON public.user_department_assignments;
CREATE TRIGGER user_department_assignment_projection
AFTER INSERT OR UPDATE OR DELETE ON public.user_department_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_user_primary_department_projection();

CREATE OR REPLACE FUNCTION public.bump_user_authorization_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET authorization_version = authorization_version + 1, updated_at = now()
  WHERE uid = COALESCE(NEW.principal_uid, OLD.principal_uid);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS permission_grant_version_bump ON public.permission_grants;
CREATE TRIGGER permission_grant_version_bump
AFTER INSERT OR UPDATE OR DELETE ON public.permission_grants
FOR EACH ROW EXECUTE FUNCTION public.bump_user_authorization_version();

-- RLS is intentionally read-only for the signed-in principal. All writes and
-- administrative reads use the backend service role.
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_department_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorization_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_roles_same_company_read ON public.organization_roles;
CREATE POLICY organization_roles_same_company_read
ON public.organization_roles FOR SELECT TO authenticated
USING (company_id = public.rls_caller_company_id());

DROP POLICY IF EXISTS user_department_assignments_self_read ON public.user_department_assignments;
CREATE POLICY user_department_assignments_self_read
ON public.user_department_assignments FOR SELECT TO authenticated
USING (user_uid = auth.uid()::text);

DROP POLICY IF EXISTS permission_grants_self_read ON public.permission_grants;
CREATE POLICY permission_grants_self_read
ON public.permission_grants FOR SELECT TO authenticated
USING (principal_uid = auth.uid()::text AND granted = true);

DROP POLICY IF EXISTS authorization_audit_logs_super_admin_read ON public.authorization_audit_logs;
CREATE POLICY authorization_audit_logs_super_admin_read
ON public.authorization_audit_logs FOR SELECT TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND public.rls_caller_role() = 'super_admin'
);

REVOKE ALL ON public.organization_roles FROM anon, authenticated;
GRANT SELECT ON public.organization_roles TO authenticated;
REVOKE ALL ON public.permission_grants FROM anon, authenticated;
GRANT SELECT ON public.permission_grants TO authenticated;
REVOKE ALL ON public.user_department_assignments FROM anon, authenticated;
GRANT SELECT ON public.user_department_assignments TO authenticated;
REVOKE ALL ON public.authorization_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.authorization_audit_logs TO authenticated;

COMMIT;
