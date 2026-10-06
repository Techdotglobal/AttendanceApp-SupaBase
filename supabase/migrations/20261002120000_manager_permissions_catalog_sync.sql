-- Keep the database contract aligned with shared/permissions/catalog.cjs.
--
-- The original manager_permissions constraint predates leave creation,
-- work-mode approvals, and approval-workflow administration. The API now
-- sends every key in the shared catalog when a super admin saves a grant list.
-- Replacing the constraint allows existing rows to remain untouched while
-- permitting all currently supported keys.

BEGIN;

ALTER TABLE public.manager_permissions
  DROP CONSTRAINT IF EXISTS manager_permissions_known_key;

ALTER TABLE public.manager_permissions
  ADD CONSTRAINT manager_permissions_known_key CHECK (
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
      'create_leave_request',
      'approve_leave',
      'reject_leave',
      'edit_leave_balance',
      'view_work_mode_requests',
      'approve_work_mode',
      'reject_work_mode',
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
      'manage_approval_workflows',
      'access_system_settings'
    ])
  );

COMMIT;
