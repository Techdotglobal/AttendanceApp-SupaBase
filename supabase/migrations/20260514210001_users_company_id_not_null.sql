-- ============================================
-- 20260514210001_users_company_id_not_null.sql
-- FIX DB-4: Enforce NOT NULL on users.company_id.
--
-- Pre-flight: Detects orphan users (NULL company_id) and raises an error
-- so the DBA can remediate them before applying the constraint.
-- After remediation, re-run to apply the constraint.
-- ============================================

BEGIN;

-- Step 1: Abort if any users still have NULL company_id.
-- Fix them first:
--   UPDATE public.users SET company_id = '<target-uuid>'
--   WHERE company_id IS NULL;
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.users
  WHERE company_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % user(s) have NULL company_id. '
      'Assign them to a valid company before re-running this migration. '
      'Query: SELECT uid, username, email FROM public.users WHERE company_id IS NULL;',
      null_count;
  END IF;
END $$;

-- Step 2: Enforce NOT NULL — safe now that we verified above
ALTER TABLE public.users ALTER COLUMN company_id SET NOT NULL;

-- Step 3: Verify the FK to companies exists (add if missing from older DBs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'users'
      AND constraint_name = 'users_company_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

-- Step 4: Add a partial index to help detect cross-tenant queries in EXPLAIN
CREATE INDEX IF NOT EXISTS idx_users_company_id
  ON public.users(company_id);

COMMENT ON COLUMN public.users.company_id IS
  'NOT NULL. Every user belongs to exactly one tenant. Set by auth-service at user-creation time.';

COMMIT;
