-- ============================================
-- Merge duplicate `companies` rows into three canonical tenants
-- ============================================
-- Picks one KEEPER per logical tenant (Netkom / TDG / TechDotGlobal) using:
--   highest user count, then oldest created_at.
-- Merges loser departments (remap sites + users, or move department row),
-- reassigns every other FK column that points at companies(id), verifies
-- nothing still references the loser UUID, then deletes the loser company row.
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
  fk RECORD;
  n_left BIGINT;
BEGIN
  IF p_loser IS NULL OR p_keeper IS NULL OR p_loser = p_keeper THEN
    RETURN;
  END IF;

  -- 1) Departments under the loser tenant: merge into keeper (respect UNIQUE (company_id, name)).
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

  IF EXISTS (SELECT 1 FROM public.departments WHERE company_id = p_loser) THEN
    RAISE EXCEPTION
      'merge_company_loser_into_keeper: % row(s) in departments still have company_id=% after merge — aborting delete',
      (SELECT COUNT(*)::INT FROM public.departments WHERE company_id = p_loser),
      p_loser;
  END IF;

  -- 2) Any other table column that FK-references public.companies(id): point to keeper.
  --    (Skips departments.company_id — already cleared above; single-column FKs only.)
  FOR fk IN
    SELECT n.nspname AS ns, c.relname AS tbl, a.attname AS col
    FROM pg_constraint co
    JOIN pg_class c ON c.oid = co.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
    WHERE co.confrelid = 'public.companies'::regclass
      AND co.contype = 'f'
      AND (co.conparentid IS NULL OR co.conparentid = 0)
      AND co.conkey IS NOT NULL
      AND array_length(co.conkey, 1) = 1
      AND n.nspname = 'public'
      AND NOT (c.relname = 'departments' AND a.attname = 'company_id')
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
      fk.ns, fk.tbl, fk.col, fk.col
    ) USING p_keeper, p_loser;
  END LOOP;

  -- 3) Refuse to delete the company row if anything still references the loser id.
  FOR fk IN
    SELECT n.nspname AS ns, c.relname AS tbl, a.attname AS col
    FROM pg_constraint co
    JOIN pg_class c ON c.oid = co.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
    WHERE co.confrelid = 'public.companies'::regclass
      AND co.contype = 'f'
      AND (co.conparentid IS NULL OR co.conparentid = 0)
      AND co.conkey IS NOT NULL
      AND array_length(co.conkey, 1) = 1
      AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I.%I WHERE %I = $1',
      fk.ns, fk.tbl, fk.col
    ) USING p_loser INTO n_left;
    IF n_left > 0 THEN
      RAISE EXCEPTION
        'merge_company_loser_into_keeper: %.% still has % row(s) referencing company id % — refusing DELETE',
        fk.ns, fk.tbl, n_left, p_loser;
    END IF;
  END LOOP;

  DELETE FROM public.companies WHERE id = p_loser;
END;
$$;

DO $$
DECLARE
  -- Do not use name "r" here: SQL aliases like `FROM _ranked r` are resolved as this
  -- PL/pgSQL variable and trigger "record r is not assigned yet" (SQLSTATE 55000).
  merge_pair RECORD;
  misc_rec RECORD;
  fk2 RECORD;
  nb BIGINT;
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
  SELECT rn.id AS loser_id, k.keeper_id
  FROM _ranked rn
  JOIN _keepers k ON k.family = rn.family
  WHERE rn.family IN ('netkom', 'tdg', 'techdotglobal')
    AND rn.id <> k.keeper_id;

  FOR merge_pair IN SELECT loser_id, keeper_id FROM _losers
  LOOP
    PERFORM public._merge_company_loser_into_keeper(merge_pair.loser_id, merge_pair.keeper_id);
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

  -- Remove misc tenant roots only when nothing in public.* still FK-references the company id.
  FOR misc_rec IN
    SELECT t.id AS mid
    FROM _classified t
    WHERE t.family = 'misc'
      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.company_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.company_id = t.id)
  LOOP
    FOR fk2 IN
      SELECT n.nspname AS ns, c.relname AS tbl, a.attname AS col
      FROM pg_constraint co
      JOIN pg_class c ON c.oid = co.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
      WHERE co.confrelid = 'public.companies'::regclass
        AND co.contype = 'f'
        AND (co.conparentid IS NULL OR co.conparentid = 0)
        AND co.conkey IS NOT NULL
        AND array_length(co.conkey, 1) = 1
        AND n.nspname = 'public'
    LOOP
      EXECUTE format(
        'SELECT COUNT(*) FROM %I.%I WHERE %I = $1',
        fk2.ns, fk2.tbl, fk2.col
      ) USING misc_rec.mid INTO nb;
      IF nb > 0 THEN
        RAISE EXCEPTION
          'Refusing to delete misc company id %: %.% still has % referencing row(s)',
          misc_rec.mid, fk2.ns, fk2.tbl, nb;
      END IF;
    END LOOP;
    DELETE FROM public.companies WHERE id = misc_rec.mid;
  END LOOP;

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
