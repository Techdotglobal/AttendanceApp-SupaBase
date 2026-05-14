-- ============================================
-- Remove legacy "first company" fallback from sync_user_department_fields
-- ============================================
-- Previously, NULL users.company_id caused the trigger to pick the oldest
-- companies row, attaching new users to the wrong tenant. Tenant isolation
-- requires explicit company_id on every row that participates in department sync.
-- ============================================

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
        RAISE EXCEPTION 'sync_user_department_fields: users.company_id is required when department is set (department "%")', NEW.department;
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
      RAISE EXCEPTION 'sync_user_department_fields: users.company_id is required when department_id is set';
    END IF;

    SELECT d.name INTO resolved_department_name
    FROM departments d
    WHERE d.id = NEW.department_id
      AND d.company_id = NEW.company_id
    LIMIT 1;

    IF resolved_department_name IS NULL THEN
      RAISE EXCEPTION 'sync_user_department_fields: department_id % does not belong to company %',
        NEW.department_id, NEW.company_id;
    END IF;

    NEW.department := resolved_department_name;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
