BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_uid text NOT NULL,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manager_permissions_manager_uid_fkey
    FOREIGN KEY (manager_uid) REFERENCES public.users(uid) ON DELETE CASCADE,
  CONSTRAINT manager_permissions_unique_key UNIQUE (manager_uid, permission_key),
  CONSTRAINT manager_permissions_known_key CHECK (
    permission_key = ANY (ARRAY[
      'create_user',
      'edit_user',
      'delete_user',
      'activate_user',
      'deactivate_user',
      'change_user_role',
      'view_employees',
      'manual_attendance',
      'view_attendance',
      'export_attendance',
      'attendance_analytics',
      'view_leave_requests',
      'approve_leave',
      'reject_leave',
      'edit_leave_balance',
      'view_tickets',
      'manage_tickets',
      'assign_tickets',
      'close_tickets',
      'manage_geofencing',
      'update_office_location',
      'update_attendance_radius',
      'view_hr_dashboard',
      'view_analytics',
      'export_reports',
      'create_events',
      'edit_events',
      'delete_events',
      'manage_notifications',
      'approve_signup_requests',
      'manage_departments',
      'access_system_settings'
    ])
  )
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL,
  target_uid text NOT NULL,
  action text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manager_permissions_manager_uid_idx
  ON public.manager_permissions(manager_uid);

CREATE INDEX IF NOT EXISTS audit_logs_target_uid_timestamp_idx
  ON public.audit_logs(target_uid, timestamp DESC);

ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage manager permissions" ON public.manager_permissions;
CREATE POLICY "Super admins manage manager permissions"
ON public.manager_permissions
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users actor
    JOIN public.users manager ON manager.uid = manager_permissions.manager_uid
    WHERE actor.uid = auth.uid()::text
      AND actor.role = 'super_admin'
      AND actor.is_active = true
      AND actor.company_id = manager.company_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users actor
    JOIN public.users manager ON manager.uid = manager_permissions.manager_uid
    WHERE actor.uid = auth.uid()::text
      AND actor.role = 'super_admin'
      AND actor.is_active = true
      AND actor.company_id = manager.company_id
  )
);

DROP POLICY IF EXISTS "Managers read own permissions" ON public.manager_permissions;
CREATE POLICY "Managers read own permissions"
ON public.manager_permissions
FOR SELECT
TO authenticated
USING (manager_uid = auth.uid()::text);

DROP POLICY IF EXISTS "Super admins read tenant audit logs" ON public.audit_logs;
CREATE POLICY "Super admins read tenant audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users actor
    JOIN public.users target_user ON target_user.uid = audit_logs.target_uid
    WHERE actor.uid = auth.uid()::text
      AND actor.role = 'super_admin'
      AND actor.is_active = true
      AND actor.company_id = target_user.company_id
  )
);

DROP POLICY IF EXISTS "Super admins insert tenant audit logs" ON public.audit_logs;
CREATE POLICY "Super admins insert tenant audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users actor
    JOIN public.users target_user ON target_user.uid = audit_logs.target_uid
    WHERE actor.uid = auth.uid()::text
      AND actor.role = 'super_admin'
      AND actor.is_active = true
      AND actor.company_id = target_user.company_id
  )
);

COMMIT;
