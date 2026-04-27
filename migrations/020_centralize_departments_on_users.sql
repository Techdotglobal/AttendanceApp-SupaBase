CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Ensure centralized departments table exists.
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Add department_id to users for strong references.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- 3) Normalization helper (trim + title case + collapse spaces).
CREATE OR REPLACE FUNCTION normalize_department_name(input_name TEXT)
RETURNS TEXT AS $$
DECLARE
  normalized TEXT;
BEGIN
  normalized := regexp_replace(COALESCE(input_name, ''), '\s+', ' ', 'g');
  normalized := btrim(normalized);
  IF normalized = '' THEN
    RETURN NULL;
  END IF;
  RETURN initcap(lower(normalized));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4) Populate departments from users.department.
INSERT INTO departments (name)
SELECT DISTINCT normalize_department_name(u.department)
FROM users u
WHERE normalize_department_name(u.department) IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- 5) Backfill users.department_id + normalize users.department string for compatibility.
UPDATE users u
SET
  department = d.name,
  department_id = d.id
FROM departments d
WHERE normalize_department_name(u.department) = d.name;

-- 6) Keep users.department and users.department_id in sync for old/new code paths.
CREATE OR REPLACE FUNCTION sync_user_department_fields()
RETURNS TRIGGER AS $$
DECLARE
  normalized_name TEXT;
  resolved_department_id UUID;
  resolved_department_name TEXT;
BEGIN
  -- If legacy department text changes, resolve/create department_id.
  IF NEW.department IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department IS DISTINCT FROM OLD.department) THEN
    normalized_name := normalize_department_name(NEW.department);
    IF normalized_name IS NOT NULL THEN
      INSERT INTO departments (name)
      VALUES (normalized_name)
      ON CONFLICT (name) DO NOTHING;

      SELECT id, name INTO resolved_department_id, resolved_department_name
      FROM departments
      WHERE name = normalized_name
      LIMIT 1;

      NEW.department_id := resolved_department_id;
      NEW.department := resolved_department_name;
    ELSE
      NEW.department_id := NULL;
      NEW.department := NULL;
    END IF;
  END IF;

  -- If department_id changes directly, update legacy department text.
  IF NEW.department_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
    SELECT name INTO resolved_department_name
    FROM departments
    WHERE id = NEW.department_id
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

-- 7) Helpful index for role + department filtering.
CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);
