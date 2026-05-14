-- ============================================
-- Merge duplicate `companies` rows into three canonical tenants
-- ============================================
-- Picks one KEEPER per logical tenant (Netkom / TDG / TechDotGlobal) using:
--   highest user count, then oldest created_at.
-- Merges loser departments (remap sites + users, or move department row),
-- moves users to keeper company_id, deletes loser company rows.
-- Removes orphan "misc" companies with no users and no departments.
-- Adds a unique index on normalized name to prevent future duplicates.
--
-- After this migration, run (from repo root, with auth-service .env loaded):
--   node scripts/sync-all-auth-metadata.js
-- ============================================

BEGIN;

CREATE OR REPLACE FUNCTION public._merge_company_loser_into_keeper(p_loser UUID, p_keeper UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  d RECORD;
  k_dept UUID;
BEGIN
  IF p_loser IS NULL OR p_keeper IS NULL OR p_loser = p_keeper THEN
    RETURN;
  END IF;

  FOR d IN
    SELECT id, name FROM public.departments WHERE company_id = p_loser
  LOOP
    SELECT id INTO k_dept
    FROM public.departments
    WHERE company_id = p_keeper AND name = d.name
    LIMIT 1;

    IF k_dept IS NOT NULL THEN
      UPDATE public.sites SET department_id = k_dept WHERE department_id = d.id;
      UPDATE public.users SET department_id = k_dept WHERE department_id = d.id;
      DELETE FROM public.departments WHERE id = d.id;
    ELSE
      UPDATE public.departments SET company_id = p_keeper WHERE id = d.id;
    END IF;
  END LOOP;

  UPDATE public.users SET company_id = p_keeper WHERE company_id = p_loser;
  DELETE FROM public.companies WHERE id = p_loser;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  CREATE TEMP TABLE _classified AS
  SELECT
    c.id,
    c.name,
    c.created_at,
    CASE
      WHEN lower(trim(c.name)) LIKE '%techdotglobal%' THEN 'techdotglobal'
      WHEN lower(trim(c.name)) LIKE '%netkom%' THEN 'netkom'
      WHEN lower(regexp_replace(trim(c.name), '\s+', '', 'g')) = 'tdg' THEN 'tdg'
      ELSE 'misc'
    END AS family
  FROM public.companies c;

  CREATE TEMP TABLE _ranked AS
  SELECT
    t.*,
    (SELECT COUNT(*)::INT FROM public.users u WHERE u.company_id = t.id) AS user_cnt
  FROM _classified t;

  CREATE TEMP TABLE _keepers AS
  SELECT DISTINCT ON (family)
    family,
    id AS keeper_id
  FROM _ranked
  WHERE family IN ('netkom', 'tdg', 'techdotglobal')
  ORDER BY family, user_cnt DESC, created_at ASC;

  CREATE TEMP TABLE _losers AS
  SELECT r.id AS loser_id, k.keeper_id
  FROM _ranked r
  JOIN _keepers k ON k.family = r.family
  WHERE r.family IN ('netkom', 'tdg', 'techdotglobal')
    AND r.id <> k.keeper_id;

  FOR r IN SELECT loser_id, keeper_id FROM _losers
  LOOP
    PERFORM public._merge_company_loser_into_keeper(r.loser_id, r.keeper_id);
  END LOOP;

  UPDATE public.companies c
  SET name = v.canonical
  FROM (
    VALUES
      ('netkom', 'Netkom Communications KSA'),
      ('tdg', 'TDG'),
      ('techdotglobal', 'TechDotGlobal')
  ) AS v(family, canonical)
  JOIN _keepers k ON k.family = v.family
  WHERE c.id = k.keeper_id;

  DELETE FROM public.companies c
  WHERE c.id IN (
    SELECT t.id
    FROM _classified t
    WHERE t.family = 'misc'
      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.company_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.company_id = t.id)
  );

  DROP TABLE IF EXISTS _losers;
  DROP TABLE IF EXISTS _keepers;
  DROP TABLE IF EXISTS _ranked;
  DROP TABLE IF EXISTS _classified;
END
$$;

DROP FUNCTION IF EXISTS public._merge_company_loser_into_keeper(UUID, UUID);

DROP INDEX IF EXISTS idx_companies_name_normalized;
CREATE UNIQUE INDEX idx_companies_name_normalized
ON public.companies (lower(regexp_replace(trim(name), '\s+', ' ', 'g')));

COMMENT ON INDEX idx_companies_name_normalized IS
  'One company per normalized display name (trim, collapse spaces, case-insensitive).';

COMMIT;
