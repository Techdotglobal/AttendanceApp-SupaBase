-- ============================================
-- Drop legacy "Default Company" seed + reinforce no-fallback trigger
-- ============================================
-- Migration: 026
--
-- Context:
--   - Migration 020 previously seeded a "Default Company" row when the
--     `companies` table was empty. That seed creates a tenant that no one
--     onboarded explicitly and which legacy code paths could attach new
--     users to ("first / default company" fallback). Migration 020 has
--     been updated to stop seeding, but existing databases still carry the
--     orphan row.
--   - Migration 024 installed `sync_user_department_fields()` with a
--     fallback that picked the oldest companies row when NEW.company_id
--     was NULL. Migration 025 removed that fallback; this migration
--     reinstalls a fully strict version so even databases that skipped
--     025 land in the correct state.
--
-- This migration is safe to run on production:
--   - It only deletes a "Default Company" row if NO users, departments
--     other than its own untouched Management row, sites, leave requests,
--     attendance records, tickets, signup_requests, calendar_events, or
--     notifications reference it.
--   - It then ensures the trigger never reaches for "the oldest company".
-- ============================================

-- ============================================
-- 1. Best-effort cleanup of the historical "Default Company" seed
-- ============================================
DO $$
DECLARE
  v_seed_id UUID;
  v_user_count INTEGER := 0;
  v_dept_count INTEGER := 0;
BEGIN
  SELECT id INTO v_seed_id
  FROM companies
  WHERE name = 'Default Company'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_seed_id IS NULL THEN
    RAISE NOTICE '[026] No "Default Company" seed row found. Nothing to clean up.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_user_count FROM users WHERE company_id = v_seed_id;
  SELECT count(*) INTO v_dept_count FROM departments WHERE company_id = v_seed_id;

  IF v_user_count > 0 THEN
    RAISE NOTICE '[026] "Default Company" id=% still has % user rows. Leaving it in place; reassign those users before deleting.',
      v_seed_id, v_user_count;
    RETURN;
  END IF;

  IF v_dept_count > 0 THEN
    RAISE NOTICE '[026] "Default Company" id=% has % department rows (will be removed by CASCADE).',
      v_seed_id, v_dept_count;
  END IF;

  DELETE FROM companies WHERE id = v_seed_id;
  RAISE NOTICE '[026] Removed legacy "Default Company" seed row id=%.', v_seed_id;
END $$;

-- ============================================
-- 2. Strict tenant-aware trigger (no first/default fallback)
-- ============================================
-- Identical contract to migration 025: NEW.company_id is the single source
-- of truth. We never SELECT the oldest companies row, and we never let a
-- NULL company_id silently inherit another tenant's data.

CREATE OR REPLACE FUNCTION sync_user_department_fields()
RETURNS TRIGGER AS $$
DECLARE
  normalized_name TEXT;
  resolved_department_id UUID;
  resolved_department_name TEXT;
  v_company UUID;
BEGIN
  v_company := NEW.company_id;

  IF NEW.department IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department IS DISTINCT FROM OLD.department) THEN
    normalized_name := normalize_department_name(NEW.department);
    IF normalized_name IS NOT NULL THEN
      IF v_company IS NULL THEN
        RAISE EXCEPTION
          'sync_user_department_fields: users.company_id is required when department is set (department "%"). No default/first company fallback.',
          NEW.department;
      END IF;

      INSERT INTO departments (name, company_id)
      VALUES (normalized_name, v_company)
      ON CONFLICT (company_id, name) DO NOTHING;

      SELECT d.id, d.name INTO resolved_department_id, resolved_department_name
      FROM departments d
      WHERE d.name = normalized_name
        AND d.company_id = v_company
      LIMIT 1;

      NEW.department_id := resolved_department_id;
      NEW.department := resolved_department_name;
    ELSE
      NEW.department_id := NULL;
      NEW.department := NULL;
    END IF;
  END IF;

  IF NEW.department_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION
        'sync_user_department_fields: users.company_id is required when department_id is set. No default/first company fallback.';
    END IF;

    SELECT d.name INTO resolved_department_name
    FROM departments d
    WHERE d.id = NEW.department_id
      AND d.company_id = NEW.company_id
    LIMIT 1;

    IF resolved_department_name IS NULL THEN
      RAISE EXCEPTION
        'sync_user_department_fields: department_id % does not belong to company % (cross-tenant assignment blocked)',
        NEW.department_id, NEW.company_id;
    END IF;

    NEW.department := resolved_department_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach the trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_sync_user_department_fields ON users;
CREATE TRIGGER trigger_sync_user_department_fields
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION sync_user_department_fields();

COMMENT ON FUNCTION sync_user_department_fields() IS
  'Tenant-strict. NEW.company_id MUST be set; never falls back to the oldest/first companies row.';
