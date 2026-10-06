-- Flexible approval authority, additive to the existing sequential workflow.
-- Legacy approver_role values remain valid and are used when authority_type is
-- LEGACY_ROLE or when an older request has no authority snapshot.

BEGIN;

ALTER TABLE public.approval_workflows
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE public.approval_workflows
  DROP CONSTRAINT IF EXISTS approval_workflows_unique_type;

DROP INDEX IF EXISTS approval_workflows_company_type_department_key;
CREATE UNIQUE INDEX IF NOT EXISTS approval_workflows_company_type_companywide_key
  ON public.approval_workflows(company_id, request_type)
  WHERE department_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_workflows_company_type_department_key
  ON public.approval_workflows(company_id, request_type, department_id)
  WHERE department_id IS NOT NULL;

ALTER TABLE public.approval_workflow_steps
  ALTER COLUMN approver_role DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS authority_type text NOT NULL DEFAULT 'LEGACY_ROLE',
  ADD COLUMN IF NOT EXISTS organization_role_id uuid REFERENCES public.organization_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_version integer;

ALTER TABLE public.approval_workflow_steps
  DROP CONSTRAINT IF EXISTS approval_workflow_steps_authority_type_check,
  ADD CONSTRAINT approval_workflow_steps_authority_type_check
    CHECK (authority_type IN ('LEGACY_ROLE', 'PERMISSION', 'ORGANIZATION_ROLE'));

-- Existing rows remain legacy role steps. Permission-based authority is
-- opt-in through newly configured workflow steps; do not reinterpret legacy
-- rows that may contain Phase 1 metadata.

ALTER TABLE public.approval_workflow_steps
  DROP CONSTRAINT IF EXISTS approval_workflow_steps_authority_config_check,
  ADD CONSTRAINT approval_workflow_steps_authority_config_check CHECK (
    (authority_type = 'LEGACY_ROLE' AND approver_role IS NOT NULL)
    OR (
      authority_type = 'PERMISSION'
      AND required_permission_key IS NOT NULL
      AND required_scope_type IN ('DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY')
      AND organization_role_id IS NULL
    )
    OR (
      authority_type = 'ORGANIZATION_ROLE'
      AND organization_role_id IS NOT NULL
      AND required_permission_key IS NOT NULL
      AND required_scope_type IN ('DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY')
    )
  );

ALTER TABLE public.approval_workflow_steps
  ADD COLUMN IF NOT EXISTS approval_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.approval_request_actions
  ADD COLUMN IF NOT EXISTS workflow_version integer,
  ADD COLUMN IF NOT EXISTS authority_type text,
  ADD COLUMN IF NOT EXISTS organization_role_id uuid REFERENCES public.organization_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS required_permission_key text,
  ADD COLUMN IF NOT EXISTS required_scope_type text,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS approval_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.work_mode_requests
  ADD COLUMN IF NOT EXISTS approval_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.approval_request_actions
  DROP CONSTRAINT IF EXISTS approval_request_actions_authority_type_check,
  ADD CONSTRAINT approval_request_actions_authority_type_check CHECK (
    authority_type IS NULL OR authority_type IN ('LEGACY_ROLE', 'PERMISSION', 'ORGANIZATION_ROLE')
  ),
  DROP CONSTRAINT IF EXISTS approval_request_actions_scope_type_check,
  ADD CONSTRAINT approval_request_actions_scope_type_check CHECK (
    required_scope_type IS NULL OR required_scope_type IN ('DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY')
  );

CREATE INDEX IF NOT EXISTS approval_workflows_company_department_idx
  ON public.approval_workflows(company_id, department_id, request_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS approval_actions_pending_company_idx
  ON public.approval_request_actions(company_id, request_type, action, step_order);

-- Fail closed if Phase 1 contains data that would make the new tenant guards
-- unsafe. These checks are read-only and do not repair production data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.approval_workflows
    GROUP BY company_id, request_type
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: duplicate approval workflows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.approval_workflow_steps s
    JOIN public.approval_workflows w ON w.id = s.workflow_id
    LEFT JOIN public.departments d ON d.id = s.department_id
    WHERE s.department_id IS NOT NULL
      AND (d.id IS NULL OR d.company_id IS DISTINCT FROM w.company_id)
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: workflow step department crosses company boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.approval_request_actions a
    LEFT JOIN public.users u ON u.uid = a.approver_uid
    WHERE a.approver_uid IS NOT NULL
      AND (u.uid IS NULL OR u.company_id IS DISTINCT FROM a.company_id)
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: approval action approver crosses company boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.users u
    LEFT JOIN public.organization_roles r ON r.id = u.organization_role_id
    WHERE u.organization_role_id IS NOT NULL
      AND (r.id IS NULL OR r.company_id IS DISTINCT FROM u.company_id)
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: user organization role crosses company boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_department_assignments a
    LEFT JOIN public.users u ON u.uid = a.user_uid
    LEFT JOIN public.departments d ON d.id = a.department_id
    WHERE u.uid IS NULL
       OR d.id IS NULL
       OR u.company_id IS DISTINCT FROM a.company_id
       OR d.company_id IS DISTINCT FROM a.company_id
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: department assignment crosses company boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.permission_grants pg
    LEFT JOIN public.users u ON u.uid = pg.principal_uid
    LEFT JOIN public.departments d ON d.id = pg.department_id
    WHERE u.uid IS NULL
       OR u.company_id IS DISTINCT FROM pg.company_id
       OR (
         pg.department_id IS NOT NULL
         AND (d.id IS NULL OR d.company_id IS DISTINCT FROM pg.company_id)
       )
  ) THEN
    RAISE EXCEPTION 'Phase 2 preflight failed: permission grant crosses company boundary';
  END IF;
END;
$$;

-- Keep tenant ownership enforceable for service-role writes as well as API
-- validation. The workflow and target department must belong to the same
-- company, and organizational-role selectors must be tenant-local.
CREATE OR REPLACE FUNCTION public.enforce_approval_workflow_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_department_company uuid;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO v_department_company
    FROM public.departments
    WHERE id = NEW.department_id;
    IF v_department_company IS NULL OR v_department_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'approval workflow department must stay within the workflow company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_workflow_company_guard ON public.approval_workflows;
CREATE TRIGGER approval_workflow_company_guard
BEFORE INSERT OR UPDATE ON public.approval_workflows
FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_workflow_company();

CREATE OR REPLACE FUNCTION public.enforce_approval_step_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role_company uuid;
  v_department_company uuid;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.approval_workflows
  WHERE id = NEW.workflow_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'approval step workflow does not exist';
  END IF;
  IF NEW.organization_role_id IS NOT NULL THEN
    SELECT company_id INTO v_role_company
    FROM public.organization_roles
    WHERE id = NEW.organization_role_id;
    IF v_role_company IS NULL OR v_role_company IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'approval step organizational role must stay within the workflow company';
    END IF;
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO v_department_company
    FROM public.departments
    WHERE id = NEW.department_id;
    IF v_department_company IS NULL OR v_department_company IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'approval step department must stay within the workflow company';
    END IF;
  END IF;
  IF NEW.approval_department_id IS NOT NULL THEN
    SELECT company_id INTO v_department_company
    FROM public.departments
    WHERE id = NEW.approval_department_id;
    IF v_department_company IS NULL OR v_department_company IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'approval step approval department must stay within the workflow company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_step_company_guard ON public.approval_workflow_steps;
CREATE TRIGGER approval_step_company_guard
BEFORE INSERT OR UPDATE ON public.approval_workflow_steps
FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_step_company();

CREATE OR REPLACE FUNCTION public.enforce_approval_action_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.approver_uid IS NOT NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.users
    WHERE uid = NEW.approver_uid;
    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'approval action approver must stay within the action company';
    END IF;
  END IF;

  IF NEW.organization_role_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.organization_roles
    WHERE id = NEW.organization_role_id;
    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'approval action organization role must stay within the action company';
    END IF;
  END IF;

  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.departments
    WHERE id = NEW.department_id;
    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'approval action department must stay within the action company';
    END IF;
  END IF;

  IF NEW.approval_department_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.departments
    WHERE id = NEW.approval_department_id;
    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'approval action approval department must stay within the action company';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_action_company_guard ON public.approval_request_actions;
CREATE TRIGGER approval_action_company_guard
BEFORE INSERT OR UPDATE OF company_id, approver_uid, organization_role_id,
  department_id, approval_department_id
ON public.approval_request_actions
FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_action_company();

CREATE OR REPLACE FUNCTION public.enforce_leave_approval_department_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.approval_department_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.departments
    WHERE id = NEW.approval_department_id;
    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'leave approval department must stay within the leave company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_approval_department_company_guard ON public.leave_requests;
CREATE TRIGGER leave_approval_department_company_guard
BEFORE INSERT OR UPDATE OF company_id, approval_department_id
ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_approval_department_company();

CREATE OR REPLACE FUNCTION public.enforce_work_mode_approval_department_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF NEW.approval_department_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.departments
    WHERE id = NEW.approval_department_id;
    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'work-mode approval department must stay within the request company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_mode_approval_department_company_guard ON public.work_mode_requests;
CREATE TRIGGER work_mode_approval_department_company_guard
BEFORE INSERT OR UPDATE OF company_id, approval_department_id
ON public.work_mode_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_work_mode_approval_department_company();

-- Clients may read only tenant-local workflow definitions and their own
-- request progress. All writes remain service-role/backend operations.
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_request_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_workflows_same_company_read ON public.approval_workflows;
CREATE POLICY approval_workflows_same_company_read
ON public.approval_workflows FOR SELECT TO authenticated
USING (company_id = public.rls_caller_company_id());

DROP POLICY IF EXISTS approval_workflow_steps_same_company_read ON public.approval_workflow_steps;
CREATE POLICY approval_workflow_steps_same_company_read
ON public.approval_workflow_steps FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.approval_workflows w
    WHERE w.id = approval_workflow_steps.workflow_id
      AND w.company_id = public.rls_caller_company_id()
  )
);

DROP POLICY IF EXISTS approval_actions_own_request_read ON public.approval_request_actions;
CREATE POLICY approval_actions_own_request_read
ON public.approval_request_actions FOR SELECT TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    approver_uid = auth.uid()::text
    OR (
      request_type IN ('annual_leave', 'sick_leave', 'casual_leave')
      AND EXISTS (
        SELECT 1 FROM public.leave_requests lr
        WHERE lr.id = approval_request_actions.request_id
          AND lr.employee_uid::text = auth.uid()::text
          AND lr.company_id = approval_request_actions.company_id
      )
    )
    OR (
      request_type = 'remote_work'
      AND EXISTS (
        SELECT 1 FROM public.work_mode_requests wr
        WHERE wr.id = approval_request_actions.request_id
          AND wr.employee_uid = auth.uid()::text
          AND wr.company_id = approval_request_actions.company_id
      )
    )
  )
);

DROP POLICY IF EXISTS approval_audit_own_request_read ON public.approval_audit_logs;
CREATE POLICY approval_audit_own_request_read
ON public.approval_audit_logs FOR SELECT TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    actor_uid = auth.uid()::text
    OR (
      request_type IN ('annual_leave', 'sick_leave', 'casual_leave')
      AND EXISTS (
        SELECT 1 FROM public.leave_requests lr
        WHERE lr.id = approval_audit_logs.request_id
          AND lr.employee_uid::text = auth.uid()::text
          AND lr.company_id = approval_audit_logs.company_id
      )
    )
    OR (
      request_type = 'remote_work'
      AND EXISTS (
        SELECT 1 FROM public.work_mode_requests wr
        WHERE wr.id = approval_audit_logs.request_id
          AND wr.employee_uid = auth.uid()::text
          AND wr.company_id = approval_audit_logs.company_id
      )
    )
  )
);

REVOKE ALL ON public.approval_workflows FROM anon, authenticated;
GRANT SELECT ON public.approval_workflows TO authenticated;
REVOKE ALL ON public.approval_workflow_steps FROM anon, authenticated;
GRANT SELECT ON public.approval_workflow_steps TO authenticated;
REVOKE ALL ON public.approval_request_actions FROM anon, authenticated;
GRANT SELECT ON public.approval_request_actions TO authenticated;
REVOKE ALL ON public.approval_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.approval_audit_logs TO authenticated;

COMMIT;
