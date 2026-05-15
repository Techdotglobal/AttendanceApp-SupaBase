-- Fix users INSERT failures when auth-service ensures departments separately.
-- Legacy trigger sync_user_department_fields():
--   - INSERT departments without normalized_name (NOT NULL after 20260515120000)
--   - SET NEW.department_id (column may not exist on live users table)
-- Replace with TEXT-only canonicalization; catalog rows use normalized_name.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_user_department_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  display_name TEXT;
  norm_key TEXT;
  canon_name TEXT;
  v_company UUID;
BEGIN
  v_company := NEW.company_id;

  IF NEW.department IS NULL OR btrim(NEW.department) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.department IS NOT DISTINCT FROM OLD.department THEN
    RETURN NEW;
  END IF;

  display_name := public.normalize_department_name(NEW.department);
  IF display_name IS NULL THEN
    NEW.department := NULL;
    RETURN NEW;
  END IF;

  norm_key := lower(trim(regexp_replace(display_name, '\s+', ' ', 'g')));

  IF v_company IS NULL THEN
    RAISE EXCEPTION
      'sync_user_department_fields: users.company_id is required when department is set (department "%")',
      NEW.department;
  END IF;

  -- Keep departments catalog in sync; do not touch users.department_id.
  INSERT INTO public.departments (name, company_id, normalized_name)
  VALUES (display_name, v_company, norm_key)
  ON CONFLICT (company_id, normalized_name) DO NOTHING;

  SELECT d.name INTO canon_name
  FROM public.departments d
  WHERE d.company_id = v_company
    AND d.normalized_name = norm_key
  LIMIT 1;

  IF canon_name IS NULL THEN
    SELECT d.name INTO canon_name
    FROM public.departments d
    WHERE d.company_id = v_company
      AND d.name = display_name
    LIMIT 1;
  END IF;

  NEW.department := COALESCE(canon_name, display_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_user_department_fields ON public.users;
CREATE TRIGGER trigger_sync_user_department_fields
  BEFORE INSERT OR UPDATE OF department, company_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_department_fields();

COMMENT ON FUNCTION public.sync_user_department_fields() IS
  'Canonicalizes users.department TEXT and ensures a tenant departments row (normalized_name). Does not set users.department_id.';

COMMIT;
