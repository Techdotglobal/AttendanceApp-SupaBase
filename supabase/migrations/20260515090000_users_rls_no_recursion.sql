-- ============================================
-- 20260515090000_users_rls_no_recursion.sql
-- FIX: 42P17 infinite recursion in users RLS policies.
--
-- Root cause: every policy that checks the caller's role/company_id
-- contained a subquery of the form:
--   EXISTS (SELECT 1 FROM users WHERE uid = auth.uid()::text AND ...)
-- Because RLS is now enabled on `users`, PostgreSQL applies the policies
-- when evaluating that subquery, which subqueries `users` again → loop.
--
-- Fix: SECURITY DEFINER helper functions in public schema.
-- A SECURITY DEFINER function runs as its owner (postgres superuser)
-- which has BYPASSRLS, so the inner SELECT on `users` bypasses RLS — no loop.
-- Functions go in public schema (not auth schema) to avoid Supabase permission
-- restrictions on the auth schema.
-- ============================================

BEGIN;

-- ============================================
-- 1. SECURITY DEFINER helpers in public schema
--    Called from RLS policies — bypass RLS because owner = postgres (BYPASSRLS).
-- ============================================

CREATE OR REPLACE FUNCTION public.rls_caller_company_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.users
  WHERE uid = auth.uid()::text
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_caller_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.users
  WHERE uid = auth.uid()::text
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_caller_department()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department
  FROM public.users
  WHERE uid = auth.uid()::text
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.rls_caller_is_active()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(is_active, false)
  FROM public.users
  WHERE uid = auth.uid()::text
  LIMIT 1
$$;

-- ============================================
-- 2. Drop all existing users policies
--    (old ones + ones from 20260512120000)
-- ============================================

DROP POLICY IF EXISTS "Authenticated users can read users"              ON users;
DROP POLICY IF EXISTS "Allow all reads"                                 ON users;
DROP POLICY IF EXISTS "Users can read all"                              ON users;
DROP POLICY IF EXISTS "Users can read own row"                          ON users;
DROP POLICY IF EXISTS "Users can read same tenant rows"                 ON users;
DROP POLICY IF EXISTS "Super admins can update work_mode for all users" ON users;
DROP POLICY IF EXISTS "HR managers can update work_mode for all employees" ON users;
DROP POLICY IF EXISTS "Managers can update work_mode for department employees" ON users;
DROP POLICY IF EXISTS "Users can update own work_mode"                  ON users;
DROP POLICY IF EXISTS "Super admins update same-tenant users"           ON users;
DROP POLICY IF EXISTS "HR managers update same-tenant non-super_admin"  ON users;
DROP POLICY IF EXISTS "Managers update department same-tenant employees" ON users;
DROP POLICY IF EXISTS "Users update own row"                            ON users;
DROP POLICY IF EXISTS "Super admins delete same-tenant users"           ON users;

-- ============================================
-- 3. SELECT policies — recursion-free
-- ============================================

-- Own row: direct column comparison, never recurses.
CREATE POLICY "Users can read own row"
ON users FOR SELECT TO authenticated
USING (uid = auth.uid()::text);

-- Same-tenant rows: SECURITY DEFINER helper resolves company_id without self-join.
CREATE POLICY "Users can read same tenant rows"
ON users FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND company_id = public.rls_caller_company_id()
);

-- ============================================
-- 4. UPDATE policies — recursion-free
-- ============================================

-- Own row update (work_mode, profile fields).
CREATE POLICY "Users update own row"
ON users FOR UPDATE TO authenticated
USING     (uid = auth.uid()::text)
WITH CHECK (uid = auth.uid()::text);

-- Super admin updates any row within their company.
CREATE POLICY "Super admins update same-tenant users"
ON users FOR UPDATE TO authenticated
USING (
  public.rls_caller_role()      = 'super_admin'
  AND public.rls_caller_is_active()
  AND company_id                = public.rls_caller_company_id()
)
WITH CHECK (
  public.rls_caller_role()      = 'super_admin'
  AND public.rls_caller_is_active()
  AND company_id                = public.rls_caller_company_id()
);

-- HR managers update non-super_admin rows in their tenant.
CREATE POLICY "HR managers update same-tenant non-super_admin"
ON users FOR UPDATE TO authenticated
USING (
  role <> 'super_admin'
  AND public.rls_caller_role()       = 'manager'
  AND public.rls_caller_department() = 'HR'
  AND public.rls_caller_is_active()
  AND company_id                     = public.rls_caller_company_id()
)
WITH CHECK (
  role <> 'super_admin'
  AND public.rls_caller_role()       = 'manager'
  AND public.rls_caller_department() = 'HR'
  AND public.rls_caller_is_active()
  AND company_id                     = public.rls_caller_company_id()
);

-- Department managers update employees in their department within their tenant.
CREATE POLICY "Managers update department same-tenant employees"
ON users FOR UPDATE TO authenticated
USING (
  role NOT IN ('super_admin', 'manager')
  AND public.rls_caller_role()       = 'manager'
  AND public.rls_caller_is_active()
  AND department                     = public.rls_caller_department()
  AND company_id                     = public.rls_caller_company_id()
)
WITH CHECK (
  role NOT IN ('super_admin', 'manager')
  AND public.rls_caller_role()       = 'manager'
  AND public.rls_caller_is_active()
  AND department                     = public.rls_caller_department()
  AND company_id                     = public.rls_caller_company_id()
);

-- ============================================
-- 5. DELETE policy — recursion-free
-- ============================================

CREATE POLICY "Super admins delete same-tenant users"
ON users FOR DELETE TO authenticated
USING (
  public.rls_caller_role()      = 'super_admin'
  AND public.rls_caller_is_active()
  AND company_id                = public.rls_caller_company_id()
);

-- ============================================
-- 6. Comments
-- ============================================

COMMENT ON FUNCTION public.rls_caller_company_id() IS
  'SECURITY DEFINER: reads company_id for the RLS caller from users, bypassing RLS. Used in users table policies to prevent 42P17 recursion.';
COMMENT ON FUNCTION public.rls_caller_role() IS
  'SECURITY DEFINER: reads role for the RLS caller from users, bypassing RLS. Used in users table policies to prevent 42P17 recursion.';
COMMENT ON FUNCTION public.rls_caller_department() IS
  'SECURITY DEFINER: reads department for the RLS caller from users, bypassing RLS. Used in users table policies to prevent 42P17 recursion.';
COMMENT ON FUNCTION public.rls_caller_is_active() IS
  'SECURITY DEFINER: reads is_active for the RLS caller from users, bypassing RLS. Used in users table policies to prevent 42P17 recursion.';

COMMENT ON TABLE users IS
  'Tenant-scoped via company_id. RLS uses public.rls_caller_* SECURITY DEFINER helpers to avoid 42P17 recursion. Service role bypasses RLS entirely.';

COMMIT;
