-- ============================================
-- 20260512120000_users_rls_tenant_isolation.sql
-- (Originally migrations/027_users_rls_tenant_isolation.sql — same SQL,
--  renamed for the Supabase CLI's timestamp-prefixed convention so
--  `supabase db push` picks it up.)
-- ============================================
-- Enable Row Level Security on `users` and replace the existing
-- single-tenant UPDATE policies with multi-tenant (company_id-scoped) ones,
-- plus add the missing SELECT/DELETE policies that prevent any signed-in
-- client from seeing or mutating users in other companies.
--
-- Without this migration the `users` table has RLS effectively disabled
-- (no `ENABLE ROW LEVEL SECURITY` was ever issued for it), so the mobile
-- app can issue `select * from users` and get back rows from every tenant
-- — regardless of what filters the JS code applies. Defense-in-depth is
-- enforced here so a stale/old mobile build cannot leak cross-company data.
--
-- Service role (used by auth-service backend) bypasses RLS automatically,
-- so onboarding, admin user-creation, and other privileged operations
-- continue to work unchanged.
-- ============================================

BEGIN;

-- ============================================
-- 1. Enable RLS
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Best-effort cleanup of older / wider policies so the new ones are the
-- single source of truth. Safe if they don't exist.
DROP POLICY IF EXISTS "Authenticated users can read users" ON users;
DROP POLICY IF EXISTS "Allow all reads" ON users;
DROP POLICY IF EXISTS "Users can read all" ON users;
DROP POLICY IF EXISTS "Users can read own row" ON users;
DROP POLICY IF EXISTS "Users can read same tenant rows" ON users;
DROP POLICY IF EXISTS "Super admins can update work_mode for all users" ON users;
DROP POLICY IF EXISTS "HR managers can update work_mode for all employees" ON users;
DROP POLICY IF EXISTS "Managers can update work_mode for department employees" ON users;
DROP POLICY IF EXISTS "Users can update own work_mode" ON users;
DROP POLICY IF EXISTS "Super admins update same-tenant users" ON users;
DROP POLICY IF EXISTS "HR managers update same-tenant non-super_admin" ON users;
DROP POLICY IF EXISTS "Managers update department same-tenant employees" ON users;
DROP POLICY IF EXISTS "Users update own row" ON users;
DROP POLICY IF EXISTS "Super admins delete same-tenant users" ON users;

-- ============================================
-- 2. SELECT policies
-- ============================================
-- A user can always read their own row (required so login / profile load
-- works before tenant_metadata is established).

CREATE POLICY "Users can read own row"
ON users
FOR SELECT
TO authenticated
USING (uid = auth.uid()::text);

-- A signed-in user can read rows in their own company only. The caller's
-- company_id is resolved from their own users row (server-side join) so a
-- malicious client cannot forge it via JWT claims.

CREATE POLICY "Users can read same tenant rows"
ON users
FOR SELECT
TO authenticated
USING (
  users.company_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users me
    WHERE me.uid = auth.uid()::text
      AND me.company_id = users.company_id
  )
);

-- ============================================
-- 3. INSERT policy (locked down)
-- ============================================
-- No INSERT policy for `authenticated` → anon/authenticated cannot insert.
-- The auth-service uses the service_role key (which bypasses RLS) for both
-- onboarding (`/api/auth/onboard-company`) and admin user-creation
-- (`/api/auth/users`), so legitimate inserts continue to work.

-- ============================================
-- 4. UPDATE policies (tenant-scoped)
-- ============================================
-- A user can update their own row.

CREATE POLICY "Users update own row"
ON users
FOR UPDATE
TO authenticated
USING (uid = auth.uid()::text)
WITH CHECK (uid = auth.uid()::text);

-- Super admins can update rows in their own tenant only.

CREATE POLICY "Super admins update same-tenant users"
ON users
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = users.company_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = users.company_id
  )
);

-- HR managers can update non-super_admin rows in their own tenant.

CREATE POLICY "HR managers update same-tenant non-super_admin"
ON users
FOR UPDATE
TO authenticated
USING (
  users.role <> 'super_admin'
  AND EXISTS (
    SELECT 1
    FROM users hr
    WHERE hr.uid = auth.uid()::text
      AND hr.role = 'manager'
      AND hr.department = 'HR'
      AND hr.is_active = true
      AND hr.company_id = users.company_id
  )
)
WITH CHECK (
  users.role <> 'super_admin'
  AND EXISTS (
    SELECT 1
    FROM users hr
    WHERE hr.uid = auth.uid()::text
      AND hr.role = 'manager'
      AND hr.department = 'HR'
      AND hr.is_active = true
      AND hr.company_id = users.company_id
  )
);

-- Department managers can update employees in their department AND tenant.

CREATE POLICY "Managers update department same-tenant employees"
ON users
FOR UPDATE
TO authenticated
USING (
  users.role NOT IN ('super_admin', 'manager')
  AND EXISTS (
    SELECT 1
    FROM users m
    WHERE m.uid = auth.uid()::text
      AND m.role = 'manager'
      AND m.is_active = true
      AND m.department = users.department
      AND m.company_id = users.company_id
  )
)
WITH CHECK (
  users.role NOT IN ('super_admin', 'manager')
  AND EXISTS (
    SELECT 1
    FROM users m
    WHERE m.uid = auth.uid()::text
      AND m.role = 'manager'
      AND m.is_active = true
      AND m.department = users.department
      AND m.company_id = users.company_id
  )
);

-- ============================================
-- 5. DELETE policy (super_admin within own tenant only)
-- ============================================

CREATE POLICY "Super admins delete same-tenant users"
ON users
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = users.company_id
  )
);

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE users IS
  'Tenant-scoped via company_id. RLS enforces: own row always readable; otherwise SELECT/UPDATE/DELETE limited to caller''s company_id. Service role (backend) bypasses RLS.';

COMMIT;
