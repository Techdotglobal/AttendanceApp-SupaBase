-- ============================================
-- 20260514210003_leave_requests_company_id.sql
-- FIX CACHE-1 (partial) + RLS hardening for leave_requests.
--
-- Problems fixed:
--   1. leave_requests had no company_id — super_admin saw all tenants' leaves
--   2. Manager policies joined users without company_id check — cross-tenant risk
--   3. Add company_id and re-scope all policies
-- ============================================

BEGIN;

-- ============================================
-- 1. Add company_id column
-- ============================================

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- ============================================
-- 2. Backfill from public.users
-- ============================================

UPDATE leave_requests lr
SET company_id = u.company_id
FROM public.users u
WHERE u.uid = lr.employee_uid::text
  AND lr.company_id IS NULL;

-- ============================================
-- 3. Index
-- ============================================

CREATE INDEX IF NOT EXISTS idx_leave_requests_company_id
  ON leave_requests(company_id);

-- ============================================
-- 4. Replace RLS policies with tenant-scoped versions
-- ============================================

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view own leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Users can create own leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Managers can view assigned leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Managers can view department leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Super admins can view all leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Managers and admins can update leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Managers can update department leave requests" ON leave_requests;

-- Employee: view own
CREATE POLICY "Employees view own leave requests"
ON leave_requests FOR SELECT TO authenticated
USING (employee_uid = auth.uid());

-- Employee: create own (must match session uid + session company)
CREATE POLICY "Employees create own leave requests"
ON leave_requests FOR INSERT TO authenticated
WITH CHECK (
  employee_uid = auth.uid()
  AND company_id IS NOT NULL
  AND company_id = (
    SELECT u.company_id FROM public.users u
    WHERE u.uid = auth.uid()::text
  )
);

-- Manager: view requests assigned to them (within same company)
CREATE POLICY "Managers view assigned leave requests"
ON leave_requests FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users m
    WHERE m.uid = auth.uid()::text
      AND m.username = leave_requests.assigned_to
      AND m.role IN ('manager', 'super_admin')
      AND m.company_id = leave_requests.company_id
  )
);

-- Manager: view department requests (same company + same department)
CREATE POLICY "Managers view department leave requests"
ON leave_requests FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users m
    JOIN public.users emp ON emp.uid = leave_requests.employee_uid::text
      AND emp.department = m.department
      AND emp.company_id = m.company_id
    WHERE m.uid = auth.uid()::text
      AND m.role = 'manager'
      AND m.is_active = true
      AND m.company_id = leave_requests.company_id
  )
);

-- Super admin: view all within OWN company only
CREATE POLICY "Super admins view own company leave requests"
ON leave_requests FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = leave_requests.company_id
  )
);

-- Admin/manager: update (process) requests in own company
CREATE POLICY "Admins and managers update own company leave requests"
ON leave_requests FOR UPDATE TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.is_active = true
      AND actor.company_id = leave_requests.company_id
      AND (
        actor.role = 'super_admin'
        OR actor.username = leave_requests.assigned_to
        OR (
          actor.role = 'manager'
          AND EXISTS (
            SELECT 1 FROM public.users emp
            WHERE emp.uid = leave_requests.employee_uid::text
              AND emp.department = actor.department
          )
        )
      )
  )
);

COMMENT ON COLUMN leave_requests.company_id IS
  'Tenant scope. Added in migration 20260514210003. Backfilled from employee_uid → users.company_id.';

COMMIT;
