-- ============================================
-- 20260514210004_leave_settings_balances.sql
-- FIX CACHE-1: Migrate leave settings and balance allocations from
-- AsyncStorage to Supabase with tenant isolation.
--
-- New tables:
--   leave_settings  — per-company default leave allocations
--   leave_balances  — per-user custom leave allocations
-- ============================================

BEGIN;

-- ============================================
-- 1. leave_settings — per-company defaults
-- ============================================

CREATE TABLE IF NOT EXISTS leave_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  default_annual_leaves  INT NOT NULL DEFAULT 20,
  default_sick_leaves    INT NOT NULL DEFAULT 10,
  default_casual_leaves  INT NOT NULL DEFAULT 5,
  leave_year_start       VARCHAR(5) NOT NULL DEFAULT '01-01',
  leave_year_end         VARCHAR(5) NOT NULL DEFAULT '12-31',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_settings_company
  ON leave_settings(company_id);

ALTER TABLE leave_settings ENABLE ROW LEVEL SECURITY;

-- Any company member can read their company's settings
CREATE POLICY "Company members read leave settings"
ON leave_settings FOR SELECT TO authenticated
USING (
  company_id IN (
    SELECT u.company_id FROM public.users u
    WHERE u.uid = auth.uid()::text
  )
);

-- Only super_admin can create/update leave settings
CREATE POLICY "Super admins manage leave settings"
ON leave_settings FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = leave_settings.company_id
  )
);

CREATE POLICY "Super admins update leave settings"
ON leave_settings FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = leave_settings.company_id
  )
);

-- updated_at trigger
CREATE TRIGGER leave_settings_updated_at
BEFORE UPDATE ON leave_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. leave_balances — per-user custom allocations
-- (used only when admin assigns non-default allowances)
-- ============================================

CREATE TABLE IF NOT EXISTS leave_balances (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uid       UUID NOT NULL,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  annual_leaves  INT NOT NULL DEFAULT 20,
  sick_leaves    INT NOT NULL DEFAULT 10,
  casual_leaves  INT NOT NULL DEFAULT 5,
  is_custom      BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_uid)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_user
  ON leave_balances(user_uid);

CREATE INDEX IF NOT EXISTS idx_leave_balances_company
  ON leave_balances(company_id);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

-- Employee reads own balance
CREATE POLICY "Employees read own leave balance"
ON leave_balances FOR SELECT TO authenticated
USING (user_uid = auth.uid());

-- Admin/manager reads any balance in their company
CREATE POLICY "Admins read own company leave balances"
ON leave_balances FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('super_admin', 'manager')
      AND actor.is_active = true
      AND actor.company_id = leave_balances.company_id
  )
);

-- Admin/manager upsert balances for their company
CREATE POLICY "Admins manage leave balances"
ON leave_balances FOR INSERT TO authenticated
WITH CHECK (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('super_admin', 'manager')
      AND actor.is_active = true
      AND actor.company_id = leave_balances.company_id
  )
);

CREATE POLICY "Admins update leave balances"
ON leave_balances FOR UPDATE TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('super_admin', 'manager')
      AND actor.is_active = true
      AND actor.company_id = leave_balances.company_id
  )
);

-- updated_at trigger
CREATE TRIGGER leave_balances_updated_at
BEFORE UPDATE ON leave_balances
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE leave_settings IS
  'Per-company leave allocation defaults. One row per company. Super_admin manages.';
COMMENT ON TABLE leave_balances IS
  'Per-user custom leave allocation overrides. When is_custom=false, UI shows company defaults. Tenant-scoped by company_id.';

COMMIT;
