-- ============================================
-- 20260514210000_companies_rls_tenant_scoped.sql
-- FIX DB-1: Replace open SELECT on companies with tenant-scoped policy.
-- Previously: any authenticated user could enumerate all companies.
-- After:      users only see the company they belong to.
-- ============================================

BEGIN;

-- Drop the open-read policy
DROP POLICY IF EXISTS "Authenticated users can read company" ON companies;
DROP POLICY IF EXISTS "Users can read own company" ON companies;

-- Users can only read their own company (resolved from public.users, not JWT)
CREATE POLICY "Users can read own company"
ON companies
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT u.company_id
    FROM public.users u
    WHERE u.uid = auth.uid()::text
      AND u.company_id IS NOT NULL
  )
);

-- Fix the UPDATE policy: also require caller to be in the SAME company (not just role=super_admin)
DROP POLICY IF EXISTS "Only super_admin can update company" ON companies;
DROP POLICY IF EXISTS "Super admins can update own company" ON companies;

CREATE POLICY "Super admins can update own company"
ON companies
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = companies.id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = companies.id
  )
);

COMMENT ON TABLE companies IS
  'Tenant root. RLS enforces: users can only read/update their own company. Service role bypasses for onboarding.';

COMMIT;
