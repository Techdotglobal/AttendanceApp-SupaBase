-- Read-only Phase 2 approval-authority preflight.
-- Run against a Phase 1 database before applying
-- 20261005100000_flexible_approval_authority.sql.
-- Every query must return zero rows unless noted otherwise.

-- Confirm the Phase 1 columns used by the Phase 2 migration exist.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'approval_workflows' AND column_name IN ('company_id', 'request_type'))
    OR (table_name = 'approval_workflow_steps' AND column_name IN (
      'workflow_id', 'approver_role', 'department_id',
      'required_permission_key', 'required_scope_type'
    ))
    OR (table_name = 'approval_request_actions' AND column_name IN (
      'company_id', 'approver_uid', 'request_type', 'request_id'
    ))
  )
ORDER BY table_name, column_name;

-- Existing Phase 1 uniqueness should make this empty.
SELECT company_id, request_type, COUNT(*) AS workflow_count
FROM public.approval_workflows
GROUP BY company_id, request_type
HAVING COUNT(*) > 1;

-- Every active or historical workflow should have at least one step.
SELECT w.id, w.company_id, w.request_type, w.name
FROM public.approval_workflows w
LEFT JOIN public.approval_workflow_steps s ON s.workflow_id = w.id
GROUP BY w.id, w.company_id, w.request_type, w.name
HAVING COUNT(s.id) = 0;

-- Existing steps must remain valid legacy steps.
SELECT s.id, s.workflow_id, s.approver_role
FROM public.approval_workflow_steps s
WHERE s.approver_role IS NULL
   OR s.approver_role NOT IN ('department_manager', 'hr', 'super_admin');

-- Foreign-key orphans and cross-company Phase 1 step departments.
SELECT s.id, s.workflow_id
FROM public.approval_workflow_steps s
LEFT JOIN public.approval_workflows w ON w.id = s.workflow_id
WHERE w.id IS NULL;

SELECT
  s.id,
  s.workflow_id,
  s.department_id,
  w.company_id AS workflow_company_id,
  d.company_id AS department_company_id
FROM public.approval_workflow_steps s
JOIN public.approval_workflows w ON w.id = s.workflow_id
LEFT JOIN public.departments d ON d.id = s.department_id
WHERE s.department_id IS NOT NULL
  AND (d.id IS NULL OR d.company_id IS DISTINCT FROM w.company_id);

-- Existing permission metadata is reported for review but is not converted
-- automatically by Phase 2; legacy approver_role behavior is preserved.
SELECT id, workflow_id, approver_role, required_permission_key, required_scope_type
FROM public.approval_workflow_steps
WHERE required_permission_key IS NOT NULL
  AND (
    required_scope_type IS NULL
    OR required_scope_type NOT IN ('OWN', 'DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY')
  );

-- Phase 1 organization-role, department-assignment, and grant references.
SELECT
  u.uid,
  u.company_id AS user_company_id,
  u.organization_role_id,
  r.company_id AS role_company_id
FROM public.users u
LEFT JOIN public.organization_roles r ON r.id = u.organization_role_id
WHERE u.organization_role_id IS NOT NULL
  AND (r.id IS NULL OR r.company_id IS DISTINCT FROM u.company_id);

SELECT
  a.id,
  a.company_id AS assignment_company_id,
  u.company_id AS user_company_id,
  d.company_id AS department_company_id
FROM public.user_department_assignments a
LEFT JOIN public.users u ON u.uid = a.user_uid
LEFT JOIN public.departments d ON d.id = a.department_id
WHERE u.uid IS NULL
   OR d.id IS NULL
   OR u.company_id IS DISTINCT FROM a.company_id
   OR d.company_id IS DISTINCT FROM a.company_id;

SELECT
  pg.id,
  pg.company_id AS grant_company_id,
  u.company_id AS principal_company_id,
  d.company_id AS department_company_id
FROM public.permission_grants pg
LEFT JOIN public.users u ON u.uid = pg.principal_uid
LEFT JOIN public.departments d ON d.id = pg.department_id
WHERE u.uid IS NULL
   OR u.company_id IS DISTINCT FROM pg.company_id
   OR (
     pg.department_id IS NOT NULL
     AND (d.id IS NULL OR d.company_id IS DISTINCT FROM pg.company_id)
   );

-- Existing approval actions must have tenant-local approvers when populated.
SELECT
  a.id,
  a.company_id AS action_company_id,
  a.approver_uid,
  u.company_id AS approver_company_id
FROM public.approval_request_actions a
LEFT JOIN public.users u ON u.uid = a.approver_uid
WHERE a.approver_uid IS NOT NULL
  AND (u.uid IS NULL OR u.company_id IS DISTINCT FROM a.company_id);

-- Existing approval actions must point to a same-company request.
SELECT
  a.id,
  a.request_type,
  a.request_id,
  a.company_id AS action_company_id,
  COALESCE(lr.company_id, wr.company_id) AS request_company_id
FROM public.approval_request_actions a
LEFT JOIN public.leave_requests lr
  ON a.request_type IN ('annual_leave', 'sick_leave', 'casual_leave')
 AND lr.id = a.request_id
LEFT JOIN public.work_mode_requests wr
  ON a.request_type = 'remote_work'
 AND wr.id = a.request_id
WHERE (
    a.request_type IN ('annual_leave', 'sick_leave', 'casual_leave')
    AND (lr.id IS NULL OR lr.company_id IS DISTINCT FROM a.company_id)
  )
  OR (
    a.request_type = 'remote_work'
    AND (wr.id IS NULL OR wr.company_id IS DISTINCT FROM a.company_id)
  );

SELECT id, request_type, request_id, step_order, action
FROM public.approval_request_actions
WHERE step_order < 1
   OR action NOT IN ('pending', 'approved', 'rejected')
   OR request_type NOT IN ('annual_leave', 'sick_leave', 'casual_leave', 'remote_work');

-- Verify the audit policy remains tenant-scoped and retains the restricted
-- remote-work self-request condition.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'approval_audit_logs'
  AND policyname = 'approval_audit_own_request_read';
