-- ============================================
-- Multi-tenant departments + sync_user_department_fields fix
-- ============================================
-- Adds departments.company_id, composite uniqueness (company_id, name),
-- tenant-scoped RLS on departments, and trigger logic that INSERTs
-- departments with company_id (no orphan global rows).
--
-- IMPORTANT (multi-tenant):
--   The UPDATE below is a ONE-TIME backfill for pre-existing department
--   rows from the single-tenant era. It picks the oldest companies row
--   solely to preserve legacy data; new tenants must NEVER inherit a
--   department this way. The trigger installed here was later replaced
--   by migration 025 (and reinstalled strictly in migration 026) to
--   forbid the "fall back to first company" behaviour entirely.
-- ============================================

-- 1) Tenant column on departments
ALTER TABLE departments
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- 2) One-time legacy backfill (single-tenant → SaaS bridge). No-op on a
--    fresh multi-tenant install.
UPDATE departments d
SET company_id = sub.id
FROM (
  SELECT id FROM companies ORDER BY created_at ASC NULLS LAST LIMIT 1
) sub
WHERE d.company_id IS NULL;

-- 3) Drop global-unique on name only (name varies by PG version / migration path)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.departments'::regclass
      AND conname = 'departments_name_key'
  ) THEN
    ALTER TABLE departments DROP CONSTRAINT departments_name_key;
  END IF;
END $$;

DROP INDEX IF EXISTS departments_name_key;

-- 4) Composite uniqueness (same name allowed per company, not across duplicate rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_company_id_name
ON departments (company_id, name);

-- 5) Require company on every department row
ALTER TABLE departments
ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_departments_company_id ON departments(company_id);

COMMENT ON COLUMN departments.company_id IS 'Tenant scope; pairs with name for unique department per company.';

-- 6) Replace trigger function (tenant-aware INSERT into departments).
--    NOTE: This version is SUPERSEDED by migrations 025 and 026, which
--    remove the "fall back to oldest company when NEW.company_id is NULL"
--    branch below. The body is kept here for historical install ordering;
--    later migrations replace the function definition.
CREATE OR REPLACE FUNCTION sync_user_department_fields()
RETURNS TRIGGER AS $$
DECLARE
  normalized_name TEXT;
  resolved_department_id UUID;
  resolved_department_name TEXT;
  v_company UUID;
BEGIN
  v_company := NEW.company_id;
  IF v_company IS NULL THEN
    -- Legacy fallback; removed in 025/026 to enforce strict tenant isolation.
    SELECT c.id INTO v_company FROM companies c ORDER BY c.created_at ASC NULLS LAST LIMIT 1;
  END IF;

  IF NEW.department IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department IS DISTINCT FROM OLD.department) THEN
    normalized_name := normalize_department_name(NEW.department);
    IF normalized_name IS NOT NULL THEN
      IF v_company IS NULL THEN
        RAISE EXCEPTION 'sync_user_department_fields: users.company_id is required for department "%"', NEW.department;
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
    SELECT d.name INTO resolved_department_name
    FROM departments d
    WHERE d.id = NEW.department_id
      AND (v_company IS NULL OR d.company_id = v_company)
    LIMIT 1;
    NEW.department := resolved_department_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_user_department_fields ON users;
CREATE TRIGGER trigger_sync_user_department_fields
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION sync_user_department_fields();

-- 7) Tenant-scoped RLS on departments (super_admin / manager see own company only)
DROP POLICY IF EXISTS "departments_super_admin_select" ON departments;
CREATE POLICY "departments_super_admin_select"
ON departments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = departments.company_id
  )
);

DROP POLICY IF EXISTS "departments_manager_select_own" ON departments;
CREATE POLICY "departments_manager_select_own"
ON departments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND u.company_id = departments.company_id
      AND (
        u.department_id = departments.id
        OR u.department = departments.name
      )
  )
);

DROP POLICY IF EXISTS "departments_super_admin_insert" ON departments;
CREATE POLICY "departments_super_admin_insert"
ON departments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = departments.company_id
  )
);

DROP POLICY IF EXISTS "departments_super_admin_update" ON departments;
CREATE POLICY "departments_super_admin_update"
ON departments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = departments.company_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = departments.company_id
  )
);

DROP POLICY IF EXISTS "departments_super_admin_delete" ON departments;
CREATE POLICY "departments_super_admin_delete"
ON departments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
      AND u.company_id = departments.company_id
  )
);
