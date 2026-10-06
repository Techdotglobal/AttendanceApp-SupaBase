-- Distributed Phase 3 finalization lock.
-- Supabase REST/RPC calls do not keep one PostgreSQL session open across the
-- Node finalization work, so a session advisory lock cannot span that work.
-- This lease table provides the same scoped exclusion with crash recovery.

BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_finalization_locks (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('observe', 'active')),
  owner_token uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (company_id, work_date, mode)
);

ALTER TABLE public.attendance_finalization_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_finalization_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.attendance_finalization_locks TO service_role;

CREATE OR REPLACE FUNCTION public.try_acquire_attendance_finalization_lock(
  p_company_id uuid,
  p_work_date date,
  p_mode text,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acquired boolean := false;
  v_lease_seconds integer := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 900), 3600));
BEGIN
  IF p_mode NOT IN ('observe', 'active') OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'invalid attendance finalization lock request';
  END IF;

  INSERT INTO public.attendance_finalization_locks
    (company_id, work_date, mode, owner_token, acquired_at, expires_at)
  VALUES
    (p_company_id, p_work_date, p_mode, p_owner_token, now(), now() + make_interval(secs => v_lease_seconds))
  ON CONFLICT (company_id, work_date, mode) DO UPDATE
    SET owner_token = EXCLUDED.owner_token,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at
    WHERE public.attendance_finalization_locks.expires_at <= now()
  RETURNING true INTO v_acquired;

  RETURN COALESCE(v_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_attendance_finalization_lock(
  p_company_id uuid,
  p_work_date date,
  p_mode text,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
  v_lease_seconds integer := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 900), 3600));
BEGIN
  UPDATE public.attendance_finalization_locks
  SET expires_at = now() + make_interval(secs => v_lease_seconds)
  WHERE company_id = p_company_id
    AND work_date = p_work_date
    AND mode = p_mode
    AND owner_token = p_owner_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_attendance_finalization_lock(
  p_company_id uuid,
  p_work_date date,
  p_mode text,
  p_owner_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.attendance_finalization_locks
  WHERE company_id = p_company_id
    AND work_date = p_work_date
    AND mode = p_mode
    AND owner_token = p_owner_token;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_attendance_finalization_lock(uuid, date, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_attendance_finalization_lock(uuid, date, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_attendance_finalization_lock(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_attendance_finalization_lock(uuid, date, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_attendance_finalization_lock(uuid, date, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_attendance_finalization_lock(uuid, date, text, uuid) TO service_role;

COMMIT;
