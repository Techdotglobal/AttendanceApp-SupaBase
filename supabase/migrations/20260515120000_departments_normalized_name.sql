-- Tenant departments: case-insensitive uniqueness via normalized_name
BEGIN;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS normalized_name TEXT;

UPDATE departments
SET normalized_name = lower(trim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g')))
WHERE normalized_name IS NULL OR btrim(normalized_name) = '';

ALTER TABLE departments
  ALTER COLUMN normalized_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_company_id_normalized_name
  ON departments (company_id, normalized_name);

COMMENT ON COLUMN departments.normalized_name IS
  'Lowercase collapsed department key for case-insensitive uniqueness per company_id.';

COMMIT;
