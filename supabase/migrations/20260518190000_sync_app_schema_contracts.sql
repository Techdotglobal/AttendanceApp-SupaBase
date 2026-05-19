-- ============================================
-- 20260518190000_sync_app_schema_contracts.sql
-- Align live schema with the app/backend contracts verified on 2026-05-18.
--
-- Safety posture:
--   * Backfill only from deterministic tenant/user relationships.
--   * Use NOT VALID checks so historical orphan rows do not block the deploy,
--     while new writes must include company_id.
--   * Keep legacy RPC names where the app already calls them.
--   * RLS policies use SECURITY DEFINER helpers to avoid users-table recursion.
-- ============================================

BEGIN;

-- --------------------------------------------
-- 1. Username normalization for global login.
-- Login accepts username without tenant context, so username must be globally
-- unique after case/space normalization.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_username(p_username TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(btrim(p_username)), '')
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS normalized_username TEXT;

UPDATE public.users
SET normalized_username = public.normalize_username(username)
WHERE normalized_username IS NULL
  AND username IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE normalized_username IS NULL
  ) THEN
    RAISE EXCEPTION 'users.normalized_username backfill failed: at least one user has blank username';
  END IF;

  IF EXISTS (
    SELECT normalized_username
    FROM public.users
    GROUP BY normalized_username
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce global username uniqueness: duplicate normalized usernames exist';
  END IF;
END $$;

ALTER TABLE public.users
  ALTER COLUMN normalized_username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_username_key
  ON public.users(normalized_username);

CREATE OR REPLACE FUNCTION public.set_users_normalized_username()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.normalized_username := public.normalize_username(NEW.username);
  IF NEW.normalized_username IS NULL THEN
    RAISE EXCEPTION 'username is required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_users_normalized_username ON public.users;
CREATE TRIGGER trigger_set_users_normalized_username
  BEFORE INSERT OR UPDATE OF username ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_users_normalized_username();

-- --------------------------------------------
-- 2. Department canonicalization should set department_id now that the column
-- exists and admin overview relies on it.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_user_department_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  display_name TEXT;
  norm_key TEXT;
  dept_row public.departments%ROWTYPE;
  v_company UUID;
BEGIN
  v_company := NEW.company_id;

  IF NEW.department IS NULL OR btrim(NEW.department) = '' THEN
    NEW.department := NULL;
    NEW.department_id := NULL;
    RETURN NEW;
  END IF;

  display_name := public.normalize_department_name(NEW.department);
  IF display_name IS NULL THEN
    NEW.department := NULL;
    NEW.department_id := NULL;
    RETURN NEW;
  END IF;

  norm_key := lower(trim(regexp_replace(display_name, '\s+', ' ', 'g')));

  IF v_company IS NULL THEN
    RAISE EXCEPTION
      'sync_user_department_fields: users.company_id is required when department is set (department "%")',
      NEW.department;
  END IF;

  INSERT INTO public.departments (name, company_id, normalized_name)
  VALUES (display_name, v_company, norm_key)
  ON CONFLICT (company_id, normalized_name) DO NOTHING;

  SELECT d.* INTO dept_row
  FROM public.departments d
  WHERE d.company_id = v_company
    AND d.normalized_name = norm_key
  LIMIT 1;

  IF dept_row.id IS NULL THEN
    RAISE EXCEPTION 'Failed to resolve department "%" for company %', display_name, v_company;
  END IF;

  NEW.department := dept_row.name;
  NEW.department_id := dept_row.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_user_department_fields ON public.users;
CREATE TRIGGER trigger_sync_user_department_fields
  BEFORE INSERT OR UPDATE OF department, company_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_department_fields();

UPDATE public.users u
SET
  department_id = d.id,
  department = d.name
FROM public.departments d
WHERE u.company_id = d.company_id
  AND u.department IS NOT NULL
  AND btrim(u.department) <> ''
  AND d.normalized_name = lower(trim(regexp_replace(public.normalize_department_name(u.department), '\s+', ' ', 'g')))
  AND (u.department_id IS DISTINCT FROM d.id OR u.department IS DISTINCT FROM d.name);

-- --------------------------------------------
-- 3. Backfill tenant-owned rows from authoritative user/department mappings.
-- --------------------------------------------

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);
ALTER TABLE public.company_offices
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Remove the explicit Codex verification artifact, if present.
DELETE FROM public.attendance_records
WHERE auth_method = 'codex_verify'
  AND location ? 'marker'
  AND location->>'marker' LIKE 'codex_schema_verify_%';

UPDATE public.attendance_records ar
SET company_id = u.company_id
FROM public.users u
WHERE ar.company_id IS NULL
  AND u.uid = ar.user_uid::text;

UPDATE public.tickets t
SET company_id = u.company_id
FROM public.users u
WHERE t.company_id IS NULL
  AND u.uid = t.created_by_uid::text;

UPDATE public.calendar_events ce
SET company_id = u.company_id
FROM public.users u
WHERE ce.company_id IS NULL
  AND u.uid = ce.created_by_uid::text;

UPDATE public.notifications n
SET company_id = u.company_id
FROM public.users u
WHERE n.company_id IS NULL
  AND u.uid = n.recipient_uid::text;

UPDATE public.sites s
SET company_id = d.company_id
FROM public.departments d
WHERE s.company_id IS NULL
  AND s.department_id = d.id;

-- Enforce future correctness without forcing unresolved historical rows to be
-- repaired inside this deploy.
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_company_id_required,
  ADD CONSTRAINT attendance_records_company_id_required CHECK (company_id IS NOT NULL) NOT VALID;

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_company_id_required,
  ADD CONSTRAINT tickets_company_id_required CHECK (company_id IS NOT NULL) NOT VALID;

ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_company_id_required,
  ADD CONSTRAINT calendar_events_company_id_required CHECK (company_id IS NOT NULL) NOT VALID;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_company_id_required,
  ADD CONSTRAINT notifications_company_id_required CHECK (company_id IS NOT NULL) NOT VALID;

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_company_id_required,
  ADD CONSTRAINT sites_company_id_required CHECK (company_id IS NOT NULL) NOT VALID;

-- Signup request processors intentionally clear the password after approval or
-- rejection; allow NULL instead of storing plaintext indefinitely.
ALTER TABLE public.signup_requests
  ALTER COLUMN password DROP NOT NULL;

COMMENT ON COLUMN public.signup_requests.password IS
  'Temporary signup secret. Cleared after approval/rejection; do not use for long-term password storage.';

-- --------------------------------------------
-- 4. Indexes for the now-canonical tenant filters.
-- --------------------------------------------

CREATE INDEX IF NOT EXISTS idx_attendance_company_timestamp
  ON public.attendance_records(company_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_company_status
  ON public.tickets(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_company_created_at
  ON public.tickets(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_events_company_date_time
  ON public.calendar_events(company_id, date, time);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read_created
  ON public.notifications(recipient_uid, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_company_created
  ON public.notifications(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_company_department
  ON public.sites(company_id, department_id);

-- Company offices are one primary office per company for the legacy geofence
-- RPC contract used by the mobile app.
DO $$
BEGIN
  IF EXISTS (
    SELECT company_id
    FROM public.company_offices
    GROUP BY company_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one company office per company: duplicate company_offices rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS company_offices_one_per_company
  ON public.company_offices(company_id);

-- --------------------------------------------
-- 5. Office-location RPCs backed by company_offices.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.get_office_location()
RETURNS TABLE (
  id UUID,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  radius_meters INTEGER,
  updated_by VARCHAR,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please log in.';
  END IF;

  v_company_id := public.rls_caller_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User is not bound to a company.';
  END IF;

  RETURN QUERY
  SELECT
    co.id,
    co.latitude,
    co.longitude,
    co.radius_meters,
    co.updated_by::VARCHAR,
    co.updated_at
  FROM public.company_offices co
  WHERE co.company_id = v_company_id
  ORDER BY co.updated_at DESC NULLS LAST, co.created_at DESC NULLS LAST
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_office_location(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 1000
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id UUID;
  v_company_id UUID;
  v_username TEXT;
  v_role TEXT;
  v_department TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please log in.';
  END IF;

  SELECT u.company_id, u.username, u.role, u.department
  INTO v_company_id, v_username, v_role, v_department
  FROM public.users u
  WHERE u.uid = auth.uid()::text
    AND COALESCE(u.is_active, false)
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User is not bound to a company.';
  END IF;

  IF NOT (v_role = 'super_admin' OR (v_role = 'manager' AND lower(coalesce(v_department, '')) = 'hr')) THEN
    RAISE EXCEPTION 'Insufficient permissions. Only super_admin and HR can update office location.';
  END IF;

  IF p_latitude < -90 OR p_latitude > 90 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90';
  END IF;
  IF p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180';
  END IF;
  IF p_radius_meters <= 0 THEN
    RAISE EXCEPTION 'Radius must be greater than 0';
  END IF;

  INSERT INTO public.company_offices (
    company_id,
    name,
    latitude,
    longitude,
    radius_meters,
    updated_by,
    updated_at
  )
  VALUES (
    v_company_id,
    'Office',
    p_latitude,
    p_longitude,
    p_radius_meters,
    v_username,
    now()
  )
  ON CONFLICT (company_id) DO UPDATE
  SET latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      radius_meters = EXCLUDED.radius_meters,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_office_location() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_office_location(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_office_location() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_office_location(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;

-- --------------------------------------------
-- 6. RLS policies for tenant-owned direct tables.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.rls_caller_username()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT username
  FROM public.users
  WHERE uid = auth.uid()::text
  LIMIT 1
$$;

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can create own attendance records" ON public.attendance_records;
CREATE POLICY "Users create own company attendance"
ON public.attendance_records
FOR INSERT
TO authenticated
WITH CHECK (
  user_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can create own tickets" ON public.tickets;
DROP POLICY IF EXISTS "Managers can view assigned tickets" ON public.tickets;
DROP POLICY IF EXISTS "Managers can view department tickets" ON public.tickets;
DROP POLICY IF EXISTS "Super admins can view all tickets" ON public.tickets;
DROP POLICY IF EXISTS "Managers and admins can update tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users view own company tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users create own company tickets" ON public.tickets;
DROP POLICY IF EXISTS "Privileged users update own company tickets" ON public.tickets;

CREATE POLICY "Users view own company tickets"
ON public.tickets
FOR SELECT
TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    created_by_uid = auth.uid()
    OR assigned_to = public.rls_caller_username()
    OR public.rls_caller_role() IN ('manager', 'super_admin')
  )
);

CREATE POLICY "Users create own company tickets"
ON public.tickets
FOR INSERT
TO authenticated
WITH CHECK (
  created_by_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
);

CREATE POLICY "Privileged users update own company tickets"
ON public.tickets
FOR UPDATE
TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    created_by_uid = auth.uid()
    OR assigned_to = public.rls_caller_username()
    OR public.rls_caller_role() IN ('manager', 'super_admin')
  )
)
WITH CHECK (
  company_id = public.rls_caller_company_id()
);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users can create calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users can update own calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users can delete own calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Super admins can view all calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Super admins can update all calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Super admins can delete calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users view own company calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users create own company calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users update own company calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Users delete own company calendar events" ON public.calendar_events;

CREATE POLICY "Users view own company calendar events"
ON public.calendar_events
FOR SELECT
TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    created_by_uid = auth.uid()
    OR visibility = 'all'
    OR (
      visibility = 'selected'
      AND (
        visible_to ? auth.uid()::text
        OR visible_to ? COALESCE(public.rls_caller_username(), '')
      )
    )
  )
);

CREATE POLICY "Users create own company calendar events"
ON public.calendar_events
FOR INSERT
TO authenticated
WITH CHECK (
  created_by_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
);

CREATE POLICY "Users update own company calendar events"
ON public.calendar_events
FOR UPDATE
TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    created_by_uid = auth.uid()
    OR public.rls_caller_role() IN ('manager', 'super_admin')
  )
)
WITH CHECK (
  company_id = public.rls_caller_company_id()
);

CREATE POLICY "Users delete own company calendar events"
ON public.calendar_events
FOR DELETE
TO authenticated
USING (
  company_id = public.rls_caller_company_id()
  AND (
    created_by_uid = auth.uid()
    OR public.rls_caller_role() IN ('manager', 'super_admin')
  )
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;

CREATE POLICY "Users view own notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  recipient_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
);

CREATE POLICY "Users update own notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  recipient_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
)
WITH CHECK (
  recipient_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
);

CREATE POLICY "Users delete own notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (
  recipient_uid = auth.uid()
  AND company_id = public.rls_caller_company_id()
);

-- Keep HR manager RLS compatible with canonicalized department names ("Hr",
-- "HR", etc.).
DROP POLICY IF EXISTS "HR managers update same-tenant non-super_admin" ON public.users;
CREATE POLICY "HR managers update same-tenant non-super_admin"
ON public.users
FOR UPDATE
TO authenticated
USING (
  role <> 'super_admin'
  AND public.rls_caller_role() = 'manager'
  AND lower(COALESCE(public.rls_caller_department(), '')) = 'hr'
  AND public.rls_caller_is_active()
  AND company_id = public.rls_caller_company_id()
)
WITH CHECK (
  role <> 'super_admin'
  AND public.rls_caller_role() = 'manager'
  AND lower(COALESCE(public.rls_caller_department(), '')) = 'hr'
  AND public.rls_caller_is_active()
  AND company_id = public.rls_caller_company_id()
);

-- --------------------------------------------
-- 7. Secure notification creation RPC.
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.create_notification(
  p_recipient_uid UUID,
  p_recipient_username VARCHAR,
  p_title TEXT,
  p_body TEXT,
  p_type VARCHAR DEFAULT 'general',
  p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id UUID;
  v_sender_company_id UUID;
  v_recipient_company_id UUID;
  v_recipient_username TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please log in.';
  END IF;

  v_sender_company_id := public.rls_caller_company_id();
  IF v_sender_company_id IS NULL THEN
    RAISE EXCEPTION 'Sender is not bound to a company.';
  END IF;

  SELECT u.company_id, u.username
  INTO v_recipient_company_id, v_recipient_username
  FROM public.users u
  WHERE u.uid = p_recipient_uid::text
    AND COALESCE(u.is_active, true)
  LIMIT 1;

  IF v_recipient_company_id IS NULL THEN
    RAISE EXCEPTION 'Recipient user not found.';
  END IF;

  IF v_recipient_company_id <> v_sender_company_id THEN
    RAISE EXCEPTION 'Cannot create cross-company notification.';
  END IF;

  INSERT INTO public.notifications (
    recipient_uid,
    recipient_username,
    title,
    body,
    type,
    data,
    company_id
  )
  VALUES (
    p_recipient_uid,
    COALESCE(NULLIF(btrim(p_recipient_username), ''), v_recipient_username),
    p_title,
    p_body,
    COALESCE(NULLIF(btrim(p_type), ''), 'general'),
    COALESCE(p_data, '{}'::jsonb),
    v_sender_company_id
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_notification(UUID, VARCHAR, TEXT, TEXT, VARCHAR, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_notification(UUID, VARCHAR, TEXT, TEXT, VARCHAR, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, VARCHAR, TEXT, TEXT, VARCHAR, JSONB) TO authenticated;

COMMENT ON FUNCTION public.create_notification(UUID, VARCHAR, TEXT, TEXT, VARCHAR, JSONB) IS
  'Creates same-company notifications only. Requires auth.uid(); sender and recipient company are derived server-side.';

COMMIT;
