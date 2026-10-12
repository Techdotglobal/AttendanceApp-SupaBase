-- Enforce one authenticated self-service attendance session per resolved workday.
--
-- This guard is intentionally limited to direct authenticated employee writes:
-- service-role imports, scheduled checkout, and admin/manual corrections retain
-- their existing raw-event contracts. Historical rows are never rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_self_service_workday_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_type text;
  v_last_timestamp timestamptz;
  v_last_created_at timestamptz;
  v_previous_checkin timestamptz;
  v_department_id uuid;
  v_timezone text;
  v_scheduled_start time;
  v_scheduled_end time;
  v_work_date date;
  v_new_local_date date;
  v_window_end timestamptz;
  v_fallback_timezone text := 'UTC';
BEGIN
  -- Only an authenticated user's own non-manual check-in is self-service.
  -- Service-role/backend writes preserve imports, corrections, and automation.
  IF COALESCE(auth.role(), '') <> 'authenticated'
     OR COALESCE(NEW.is_manual, false)
     OR lower(COALESCE(NEW.type, '')) <> 'checkin' THEN
    RETURN NEW;
  END IF;

  -- Serialize all direct self-service writes for this tenant/user. The lock is
  -- transaction-scoped and therefore released automatically on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    COALESCE(NEW.company_id::text, '') || ':' || NEW.user_uid::text,
    0
  ));

  -- The latest event is read under the same transaction lock, so two devices
  -- cannot both observe an open/complete session and insert concurrently. Use
  -- arrival order for the guard rather than trusting a device-supplied event
  -- timestamp (offline/two-device clocks may differ).
  SELECT lower(COALESCE(r.type, '')), r.timestamp, r.created_at
    INTO v_last_type, v_last_timestamp, v_last_created_at
  FROM public.attendance_records r
  WHERE r.company_id = NEW.company_id
    AND r.user_uid = NEW.user_uid
  ORDER BY COALESCE(r.created_at, r.timestamp) DESC, r.timestamp DESC, r.id DESC
  LIMIT 1;

  IF v_last_type IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_last_type = 'checkin' THEN
    RAISE EXCEPTION 'A self-service attendance session is already open for this workday'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_last_type <> 'checkout' THEN
    RETURN NEW;
  END IF;

  -- Resolve the primary active department, retaining the legacy projection as
  -- the fallback used by the existing attendance rule resolver.
  SELECT a.department_id
    INTO v_department_id
  FROM public.user_department_assignments a
  WHERE a.company_id = NEW.company_id
    AND a.user_uid = NEW.user_uid::text
    AND a.is_active = true
  ORDER BY a.is_primary DESC, a.created_at ASC NULLS LAST, a.id ASC
  LIMIT 1;

  IF v_department_id IS NULL THEN
    SELECT u.department_id
      INTO v_department_id
    FROM public.users u
    WHERE u.company_id = NEW.company_id
      AND u.uid = NEW.user_uid::text
    LIMIT 1;
  END IF;

  -- Legacy/no-schedule workdays use the tenant's trusted company timezone.
  -- The default is UTC, matching the existing server/runtime default; client
  -- or device timezone values are never consulted by this trigger.
  SELECT COALESCE(NULLIF(c.app_settings #>> '{company,timezone}', ''), 'UTC')
    INTO v_fallback_timezone
  FROM public.companies c
  WHERE c.id = NEW.company_id;
  IF NOT EXISTS (
    SELECT 1 FROM pg_timezone_names z WHERE z.name = v_fallback_timezone
  ) THEN
    v_fallback_timezone := 'UTC';
  END IF;

  SELECT r.timestamp
    INTO v_previous_checkin
  FROM public.attendance_records r
  WHERE r.company_id = NEW.company_id
    AND r.user_uid = NEW.user_uid
    AND lower(COALESCE(r.type, '')) = 'checkin'
    AND COALESCE(r.created_at, r.timestamp) <= COALESCE(v_last_created_at, v_last_timestamp)
  ORDER BY COALESCE(r.created_at, r.timestamp) DESC, r.timestamp DESC, r.id DESC
  LIMIT 1;

  IF v_previous_checkin IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve the same USER -> PRIMARY DEPARTMENT -> COMPANY precedence used by
  -- Phase 3. The previous check-in's local date selects its effective rule.
  SELECT r.timezone, r.scheduled_start, r.scheduled_end
    INTO v_timezone, v_scheduled_start, v_scheduled_end
  FROM public.attendance_schedule_rules r
  WHERE r.company_id = NEW.company_id
    AND (
      (r.scope_type = 'USER' AND r.user_uid = NEW.user_uid::text)
      OR (r.scope_type = 'DEPARTMENT' AND r.department_id = v_department_id)
      OR (r.scope_type = 'COMPANY')
    )
    AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = r.timezone)
    AND r.effective_from <= (
      v_previous_checkin AT TIME ZONE (CASE
        WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = r.timezone)
        THEN r.timezone ELSE 'UTC' END)
    )::date
    AND (r.effective_to IS NULL OR r.effective_to >= (
      v_previous_checkin AT TIME ZONE (CASE
        WHEN EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = r.timezone)
        THEN r.timezone ELSE 'UTC' END)
    )::date)
  ORDER BY CASE r.scope_type WHEN 'USER' THEN 1 WHEN 'DEPARTMENT' THEN 2 ELSE 3 END,
           r.effective_from DESC,
           r.version DESC,
           r.id ASC
  LIMIT 1;

  IF v_timezone IS NOT NULL THEN
    v_work_date := (v_previous_checkin AT TIME ZONE v_timezone)::date;
    v_new_local_date := (NEW.timestamp AT TIME ZONE v_timezone)::date;
    v_window_end := ((v_work_date + v_scheduled_end) AT TIME ZONE v_timezone)
      + CASE WHEN v_scheduled_end <= v_scheduled_start THEN interval '1 day' ELSE interval '0 day' END;

    -- Day schedules remain closed for the complete local work date. Overnight
    -- schedules roll to the next local workday only after their window ends.
    IF (v_scheduled_end > v_scheduled_start AND v_new_local_date = v_work_date)
       OR (v_scheduled_end <= v_scheduled_start AND NEW.timestamp <= v_window_end) THEN
      RAISE EXCEPTION 'A self-service attendance session is already complete for this workday'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.timestamp AT TIME ZONE v_fallback_timezone)::date =
        (v_last_timestamp AT TIME ZONE v_fallback_timezone)::date THEN
    -- Legacy/no-rule fallback: use the trusted company timezone, never a
    -- client/device timezone.
    RAISE EXCEPTION 'A self-service attendance session is already complete for this workday'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Reject invalid IANA zones on new/edited rules. Existing invalid legacy rows
-- remain untouched; the self-service guard ignores them and uses the trusted
-- company fallback timezone instead.
CREATE OR REPLACE FUNCTION public.attendance_schedule_timezone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_timezone_names z WHERE z.name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'attendance schedule timezone must be a valid IANA timezone'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_schedule_timezone_guard ON public.attendance_schedule_rules;
CREATE TRIGGER attendance_schedule_timezone_guard
BEFORE INSERT OR UPDATE ON public.attendance_schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.attendance_schedule_timezone_guard();

DROP TRIGGER IF EXISTS attendance_self_service_workday_guard ON public.attendance_records;
CREATE TRIGGER attendance_self_service_workday_guard
BEFORE INSERT ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.attendance_self_service_workday_guard();

REVOKE EXECUTE ON FUNCTION public.attendance_self_service_workday_guard()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.attendance_schedule_timezone_guard()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
