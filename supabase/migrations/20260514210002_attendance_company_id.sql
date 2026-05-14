-- ============================================
-- 20260514210002_attendance_company_id.sql
-- FIX DB-6: Add company_id to attendance_records.
--
-- Goals:
--   1. Add company_id column and backfill from public.users
--   2. Replace join-based tenant queries (expensive) with direct eq filter
--   3. Fix RLS: super_admin policy was not tenant-scoped (cross-company leak)
--   4. Fix RLS: manager policy was missing company_id check
-- ============================================

BEGIN;

-- ============================================
-- 1. Add company_id column
-- ============================================

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- ============================================
-- 2. Backfill from public.users
-- Records with valid user_uid get the company from that user's row.
-- Orphaned records (user deleted) remain NULL — they are historical artifacts.
-- ============================================

UPDATE attendance_records ar
SET company_id = u.company_id
FROM public.users u
WHERE u.uid = ar.user_uid::text
  AND ar.company_id IS NULL;

-- ============================================
-- 3. Index for tenant-scoped reads
-- ============================================

CREATE INDEX IF NOT EXISTS idx_attendance_company_id
  ON attendance_records(company_id);

CREATE INDEX IF NOT EXISTS idx_attendance_company_timestamp
  ON attendance_records(company_id, timestamp DESC);

-- ============================================
-- 4. Replace RLS policies with tenant-scoped versions
-- ============================================

-- Remove the old broad super_admin policy (cross-company leak)
DROP POLICY IF EXISTS "Super admins can view all attendance records" ON attendance_records;

-- Super admins see all records within their own company only
CREATE POLICY "Super admins view own company attendance"
ON attendance_records
FOR SELECT
TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users sa
    WHERE sa.uid = auth.uid()::text
      AND sa.role = 'super_admin'
      AND sa.is_active = true
      AND sa.company_id = attendance_records.company_id
  )
);

-- Remove old manager policy (no company_id check)
DROP POLICY IF EXISTS "Managers can view department attendance records" ON attendance_records;

-- Managers see records for employees in their department AND their company
CREATE POLICY "Managers view own company department attendance"
ON attendance_records
FOR SELECT
TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users m
    WHERE m.uid = auth.uid()::text
      AND m.role = 'manager'
      AND m.is_active = true
      AND m.company_id = attendance_records.company_id
      AND EXISTS (
        SELECT 1 FROM public.users emp
        WHERE emp.uid = attendance_records.user_uid::text
          AND emp.department = m.department
          AND emp.company_id = attendance_records.company_id
      )
  )
);

-- Update policies also need tenant scoping
DROP POLICY IF EXISTS "Managers and admins can update attendance records" ON attendance_records;

CREATE POLICY "Managers and admins update own company attendance"
ON attendance_records
FOR UPDATE
TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.is_active = true
      AND actor.company_id = attendance_records.company_id
      AND (
        actor.role = 'super_admin'
        OR (
          actor.role = 'manager'
          AND EXISTS (
            SELECT 1 FROM public.users emp
            WHERE emp.uid = attendance_records.user_uid::text
              AND emp.department = actor.department
          )
        )
      )
  )
);

DROP POLICY IF EXISTS "Managers and admins can delete attendance records" ON attendance_records;

CREATE POLICY "Managers and admins delete own company attendance"
ON attendance_records
FOR DELETE
TO authenticated
USING (
  company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.is_active = true
      AND actor.company_id = attendance_records.company_id
      AND (
        actor.role = 'super_admin'
        OR (
          actor.role = 'manager'
          AND EXISTS (
            SELECT 1 FROM public.users emp
            WHERE emp.uid = attendance_records.user_uid::text
              AND emp.department = actor.department
          )
        )
      )
  )
);

-- Manual insert: require company_id to match actor's tenant
DROP POLICY IF EXISTS "Managers and admins can create manual attendance records" ON attendance_records;

CREATE POLICY "Managers and admins create manual attendance own company"
ON attendance_records
FOR INSERT
TO authenticated
WITH CHECK (
  is_manual = true
  AND company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('manager', 'super_admin')
      AND actor.is_active = true
      AND actor.company_id = attendance_records.company_id
  )
);

COMMENT ON COLUMN attendance_records.company_id IS
  'Tenant scope. Backfilled from public.users.company_id at migration time. NULL = orphaned historical record (user deleted).';

COMMIT;
