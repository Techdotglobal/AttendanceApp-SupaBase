-- Attendance Rules V1 (additive)
-- Raw attendance_records remain the historical source of truth. This migration
-- adds rule configuration, derived daily summaries, and race-safe scheduled
-- checkout metadata without changing legacy pairing or client write paths.

BEGIN;

-- Production companies may predate the shared app-settings migration. Keep
-- the Phase 3 feature flag in the same tenant-owned JSON document used by the
-- runtime, but create the column additively so existing tenants and rows are
-- preserved. The default keeps the legacy attendance path disabled.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS app_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS checkout_source text,
  ADD COLUMN IF NOT EXISTS checkout_reason text,
  ADD COLUMN IF NOT EXISTS auto_checkout_checkin_id uuid;

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_checkout_source_check,
  ADD CONSTRAINT attendance_records_checkout_source_check CHECK (
    checkout_source IS NULL OR checkout_source IN
      ('manual', 'automatic_geofence', 'automatic_schedule', 'legacy')
  );

ALTER TABLE public.manager_permissions
  DROP CONSTRAINT IF EXISTS manager_permissions_known_key;
ALTER TABLE public.manager_permissions
  ADD CONSTRAINT manager_permissions_known_key CHECK (
    permission_key = ANY (ARRAY[
      'create_user','edit_user','delete_user','activate_user','deactivate_user',
      'change_user_role','assign_user_department','assign_user_permissions','view_employees',
      'manual_attendance','view_attendance','export_attendance','attendance_analytics',
      'manage_attendance_rules',
      'view_leave_requests','create_leave_request','approve_leave','reject_leave','edit_leave_balance',
      'view_work_mode_requests','approve_work_mode','reject_work_mode',
      'view_tickets','manage_tickets','assign_tickets','close_tickets',
      'manage_geofencing','update_office_location','update_attendance_radius',
      'view_hr_dashboard','view_analytics','export_reports','view_reports',
      'create_events','edit_events','delete_events','manage_notifications',
      'approve_signup_requests','manage_departments','manage_approval_workflows',
      'manage_workflows','access_system_settings','view_payroll','manage_payroll'
    ])
  );

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_auto_checkout_checkin_fkey,
  ADD CONSTRAINT attendance_records_auto_checkout_checkin_fkey
    FOREIGN KEY (auto_checkout_checkin_id)
    REFERENCES public.attendance_records(id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_one_scheduled_checkout
  ON public.attendance_records(auto_checkout_checkin_id)
  WHERE checkout_source = 'automatic_schedule' AND auto_checkout_checkin_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.attendance_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('COMPANY', 'DEPARTMENT', 'USER')),
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  user_uid text REFERENCES public.users(uid) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  scheduled_start time NOT NULL,
  scheduled_end time NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 1440),
  working_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  overtime_enabled boolean NOT NULL DEFAULT false,
  overtime_window_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_window_minutes BETWEEN 0 AND 1440),
  auto_checkout_enabled boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,
  effective_to date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  updated_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_schedule_rules_scope_check CHECK (
    (scope_type = 'COMPANY' AND department_id IS NULL AND user_uid IS NULL)
    OR (scope_type = 'DEPARTMENT' AND department_id IS NOT NULL AND user_uid IS NULL)
    OR (scope_type = 'USER' AND department_id IS NULL AND user_uid IS NOT NULL)
  ),
  CONSTRAINT attendance_schedule_rules_dates_check CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT attendance_schedule_rules_weekdays_check CHECK (
    cardinality(working_days) BETWEEN 0 AND 7
    AND NOT (working_days && ARRAY[0,8,9,10,11,12,13,14,15,16,17,18,19,20,21]::smallint[])
  )
);

CREATE INDEX IF NOT EXISTS attendance_schedule_rules_company_effective_idx
  ON public.attendance_schedule_rules(company_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS attendance_schedule_rules_department_idx
  ON public.attendance_schedule_rules(company_id, department_id, effective_from)
  WHERE scope_type = 'DEPARTMENT';
CREATE INDEX IF NOT EXISTS attendance_schedule_rules_user_idx
  ON public.attendance_schedule_rules(company_id, user_uid, effective_from)
  WHERE scope_type = 'USER';

CREATE TABLE IF NOT EXISTS public.attendance_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  holiday_type text NOT NULL DEFAULT 'public',
  is_working_day boolean NOT NULL DEFAULT false,
  created_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  updated_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS attendance_holidays_company_date_idx
  ON public.attendance_holidays(company_id, holiday_date);

CREATE TABLE IF NOT EXISTS public.attendance_daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_uid text NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  work_date date NOT NULL,
  schedule_rule_id uuid REFERENCES public.attendance_schedule_rules(id) ON DELETE SET NULL,
  schedule_version integer,
  timezone text NOT NULL DEFAULT 'UTC',
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  scheduled_duration_seconds integer NOT NULL DEFAULT 0,
  checkin_id uuid REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  checkout_id uuid REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  checkin_at timestamptz,
  checkout_at timestamptz,
  checkout_source text,
  late_seconds integer NOT NULL DEFAULT 0 CHECK (late_seconds >= 0),
  worked_seconds integer NOT NULL DEFAULT 0 CHECK (worked_seconds >= 0),
  regular_seconds integer NOT NULL DEFAULT 0 CHECK (regular_seconds >= 0),
  overtime_seconds integer NOT NULL DEFAULT 0 CHECK (overtime_seconds >= 0),
  status text NOT NULL DEFAULT 'OPEN',
  holiday_id uuid REFERENCES public.attendance_holidays(id) ON DELETE SET NULL,
  leave_request_id uuid REFERENCES public.leave_requests(id) ON DELETE SET NULL,
  absence_eligible boolean NOT NULL DEFAULT false,
  needs_refinalization boolean NOT NULL DEFAULT false,
  finalized_at timestamptz,
  absence_prepared_at timestamptz,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_uid, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_daily_summaries_company_date_idx
  ON public.attendance_daily_summaries(company_id, work_date DESC);
CREATE INDEX IF NOT EXISTS attendance_daily_summaries_user_date_idx
  ON public.attendance_daily_summaries(user_uid, work_date DESC);

CREATE TABLE IF NOT EXISTS public.attendance_finalization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  mode text NOT NULL DEFAULT 'active' CHECK (mode IN ('observe', 'active')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  UNIQUE (company_id, work_date, mode)
);

CREATE OR REPLACE FUNCTION public.attendance_rules_company_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_department_company uuid;
  v_user_company uuid;
  v_actor_company uuid;
  v_rule_company uuid;
  v_record_company uuid;
  v_holiday_company uuid;
  v_leave_company uuid;
  v_record_user text;
  v_leave_user text;
BEGIN
  IF TG_TABLE_NAME = 'attendance_schedule_rules' THEN
    IF NEW.department_id IS NOT NULL THEN
      SELECT company_id INTO v_department_company FROM public.departments WHERE id = NEW.department_id;
      IF v_department_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'attendance schedule department must belong to its company';
      END IF;
    END IF;
    IF NEW.user_uid IS NOT NULL THEN
      SELECT company_id INTO v_user_company FROM public.users WHERE uid = NEW.user_uid;
      IF v_user_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'attendance schedule user must belong to its company';
      END IF;
    END IF;
    IF NEW.created_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.created_by_uid;
      IF v_actor_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'schedule actor must belong to its company'; END IF;
    END IF;
    IF NEW.updated_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.updated_by_uid;
      IF v_actor_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'schedule actor must belong to its company'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_holidays' THEN
    IF NEW.created_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.created_by_uid;
      IF v_actor_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'holiday actor must belong to its company'; END IF;
    END IF;
    IF NEW.updated_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.updated_by_uid;
      IF v_actor_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'holiday actor must belong to its company'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_daily_summaries' THEN
    SELECT company_id INTO v_user_company FROM public.users WHERE uid = NEW.user_uid;
    IF v_user_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'attendance summary user must belong to its company';
    END IF;
    IF NEW.schedule_rule_id IS NOT NULL THEN
      SELECT company_id INTO v_rule_company FROM public.attendance_schedule_rules WHERE id = NEW.schedule_rule_id;
      IF v_rule_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'summary schedule rule must belong to its company'; END IF;
    END IF;
    IF NEW.checkin_id IS NOT NULL THEN
      SELECT company_id, user_uid::text INTO v_record_company, v_record_user FROM public.attendance_records WHERE id = NEW.checkin_id;
      IF v_record_company IS DISTINCT FROM NEW.company_id OR v_record_user IS DISTINCT FROM NEW.user_uid::text THEN
        RAISE EXCEPTION 'summary check-in must belong to its company and user';
      END IF;
    END IF;
    IF NEW.checkout_id IS NOT NULL THEN
      SELECT company_id, user_uid::text INTO v_record_company, v_record_user FROM public.attendance_records WHERE id = NEW.checkout_id;
      IF v_record_company IS DISTINCT FROM NEW.company_id OR v_record_user IS DISTINCT FROM NEW.user_uid::text THEN
        RAISE EXCEPTION 'summary checkout must belong to its company and user';
      END IF;
    END IF;
    IF NEW.holiday_id IS NOT NULL THEN
      SELECT company_id INTO v_holiday_company FROM public.attendance_holidays WHERE id = NEW.holiday_id;
      IF v_holiday_company IS DISTINCT FROM NEW.company_id THEN RAISE EXCEPTION 'summary holiday must belong to its company'; END IF;
    END IF;
    IF NEW.leave_request_id IS NOT NULL THEN
      SELECT company_id, employee_uid::text INTO v_leave_company, v_leave_user FROM public.leave_requests WHERE id = NEW.leave_request_id;
      IF v_leave_company IS DISTINCT FROM NEW.company_id OR v_leave_user IS DISTINCT FROM NEW.user_uid::text THEN
        RAISE EXCEPTION 'summary leave request must belong to its company and user';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_records' THEN
    IF NEW.auto_checkout_checkin_id IS NOT NULL THEN
      SELECT company_id, user_uid::text INTO v_record_company, v_record_user FROM public.attendance_records WHERE id = NEW.auto_checkout_checkin_id;
      IF v_record_company IS DISTINCT FROM NEW.company_id OR v_record_user IS DISTINCT FROM NEW.user_uid::text THEN
        RAISE EXCEPTION 'automatic checkout check-in must belong to its company and user';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE id = NEW.auto_checkout_checkin_id AND lower(type) = 'checkin'
      ) THEN
        RAISE EXCEPTION 'automatic checkout parent must be a check-in';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_schedule_rules_company_guard ON public.attendance_schedule_rules;
CREATE TRIGGER attendance_schedule_rules_company_guard
BEFORE INSERT OR UPDATE ON public.attendance_schedule_rules
FOR EACH ROW EXECUTE FUNCTION public.attendance_rules_company_guard();

DROP TRIGGER IF EXISTS attendance_daily_summaries_company_guard ON public.attendance_daily_summaries;
CREATE TRIGGER attendance_daily_summaries_company_guard
BEFORE INSERT OR UPDATE ON public.attendance_daily_summaries
FOR EACH ROW EXECUTE FUNCTION public.attendance_rules_company_guard();

CREATE OR REPLACE FUNCTION public.attendance_daily_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Foreign-key cleanup may null schedule_rule_id when an old rule is deleted;
  -- all other schedule context fields remain immutable. Finalization may only
  -- append invalid-event diagnostics to the JSON snapshot.
  IF pg_trigger_depth() = 0 AND (
    NEW.schedule_version IS DISTINCT FROM OLD.schedule_version
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
    OR NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
    OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at
    OR NEW.scheduled_duration_seconds IS DISTINCT FROM OLD.scheduled_duration_seconds
    OR (NEW.calculation_snapshot - 'invalid_events') IS DISTINCT FROM (OLD.calculation_snapshot - 'invalid_events')
  ) THEN
    RAISE EXCEPTION 'attendance daily schedule snapshot is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_daily_snapshot_guard ON public.attendance_daily_summaries;
CREATE TRIGGER attendance_daily_snapshot_guard
BEFORE UPDATE ON public.attendance_daily_summaries
FOR EACH ROW EXECUTE FUNCTION public.attendance_daily_snapshot_guard();

DROP TRIGGER IF EXISTS attendance_holidays_company_guard ON public.attendance_holidays;
CREATE TRIGGER attendance_holidays_company_guard
BEFORE INSERT OR UPDATE ON public.attendance_holidays
FOR EACH ROW EXECUTE FUNCTION public.attendance_rules_company_guard();

DROP TRIGGER IF EXISTS attendance_records_rules_company_guard ON public.attendance_records;
CREATE TRIGGER attendance_records_rules_company_guard
BEFORE INSERT OR UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.attendance_rules_company_guard();

CREATE OR REPLACE FUNCTION public.attendance_scheduled_metadata_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.checkout_source = 'automatic_schedule' OR NEW.auto_checkout_checkin_id IS NOT NULL)
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'scheduled metadata is server-managed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_scheduled_metadata_guard ON public.attendance_records;
CREATE TRIGGER attendance_scheduled_metadata_guard
BEFORE INSERT OR UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.attendance_scheduled_metadata_guard();

CREATE OR REPLACE FUNCTION public.attendance_schedule_rules_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.attendance_schedule_rules r
    WHERE r.id <> NEW.id
      AND r.company_id = NEW.company_id
      AND r.scope_type = NEW.scope_type
      AND r.department_id IS NOT DISTINCT FROM NEW.department_id
      AND r.user_uid IS NOT DISTINCT FROM NEW.user_uid
      AND daterange(r.effective_from, COALESCE(r.effective_to, 'infinity'::date), '[]')
          && daterange(NEW.effective_from, COALESCE(NEW.effective_to, 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'attendance schedule effective dates overlap for this scope';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_schedule_rules_no_overlap ON public.attendance_schedule_rules;
CREATE CONSTRAINT TRIGGER attendance_schedule_rules_no_overlap
AFTER INSERT OR UPDATE ON public.attendance_schedule_rules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.attendance_schedule_rules_no_overlap();

-- Serialize non-manual checkout writes per employee and prevent a second
-- checkout after an automatic scheduled checkout. Manual correction routes are
-- intentionally exempt and can repair an automatically closed session.
CREATE OR REPLACE FUNCTION public.attendance_checkout_sequence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_type text;
  v_checkin_id uuid;
BEGIN
  IF lower(COALESCE(NEW.type, '')) <> 'checkout' OR COALESCE(NEW.is_manual, false) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.company_id::text, '') || ':' || NEW.user_uid::text, 0));

  SELECT r.type, r.id
    INTO v_last_type, v_checkin_id
  FROM public.attendance_records r
  WHERE r.company_id = NEW.company_id
    AND r.user_uid = NEW.user_uid
    AND r.timestamp <= NEW.timestamp
  ORDER BY r.timestamp DESC, r.created_at DESC
  LIMIT 1;

  -- Preserve late mobile/offline events as raw, auditable unmatched events.
  -- The pure pairing layer prevents these duplicate events from becoming the
  -- authoritative checkout, while the mobile queue remains unchanged.
  IF lower(COALESCE(v_last_type, '')) = 'checkout' AND NEW.checkout_reason IS NULL THEN
    NEW.checkout_reason := 'DUPLICATE_AFTER_CHECKOUT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records a
    WHERE a.auto_checkout_checkin_id = v_checkin_id
      AND a.checkout_source = 'automatic_schedule'
  ) AND NEW.checkout_reason IS NULL THEN
    NEW.checkout_reason := 'DUPLICATE_AFTER_AUTOMATIC_SCHEDULE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_checkout_sequence_guard ON public.attendance_records;
CREATE TRIGGER attendance_checkout_sequence_guard
BEFORE INSERT ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.attendance_checkout_sequence_guard();

CREATE OR REPLACE FUNCTION public.create_scheduled_attendance_checkout(
  p_company_id uuid,
  p_checkin_id uuid,
  p_scheduled_end_at timestamptz
)
RETURNS public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkin public.attendance_records%ROWTYPE;
  v_existing public.attendance_records%ROWTYPE;
  v_created public.attendance_records%ROWTYPE;
BEGIN
  SELECT * INTO v_checkin
  FROM public.attendance_records
  WHERE id = p_checkin_id AND company_id = p_company_id AND lower(type) = 'checkin'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || v_checkin.user_uid::text, 0));

  SELECT * INTO v_existing
  FROM public.attendance_records
  WHERE auto_checkout_checkin_id = p_checkin_id
    AND checkout_source = 'automatic_schedule'
  LIMIT 1;
  IF FOUND THEN RETURN v_existing; END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_records r
    WHERE r.company_id = p_company_id
      AND r.user_uid = v_checkin.user_uid
      AND lower(r.type) = 'checkout'
      AND r.timestamp >= v_checkin.timestamp
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.attendance_records (
    user_uid, company_id, username, employee_name, type, timestamp,
    auth_method, is_manual, created_by, checkout_source, checkout_reason,
    auto_checkout_checkin_id
  )
  VALUES (
    v_checkin.user_uid, p_company_id, v_checkin.username, v_checkin.employee_name,
    'checkout', p_scheduled_end_at, 'automatic_schedule', false,
    'attendance-finalizer', 'automatic_schedule', 'SCHEDULED_END', p_checkin_id
  )
  RETURNING * INTO v_created;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_scheduled_attendance_checkout(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_scheduled_attendance_checkout(uuid, uuid, timestamptz) TO service_role;

ALTER TABLE public.attendance_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_finalization_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_schedule_rules_same_company_read ON public.attendance_schedule_rules;

DROP POLICY IF EXISTS attendance_holidays_same_company_read ON public.attendance_holidays;

DROP POLICY IF EXISTS attendance_daily_summaries_own_read ON public.attendance_daily_summaries;
CREATE POLICY attendance_daily_summaries_own_read
ON public.attendance_daily_summaries FOR SELECT TO authenticated
USING (company_id = public.rls_caller_company_id() AND user_uid = auth.uid()::text);

REVOKE ALL ON public.attendance_schedule_rules FROM anon, authenticated;
REVOKE ALL ON public.attendance_holidays FROM anon, authenticated;
REVOKE ALL ON public.attendance_daily_summaries FROM anon, authenticated;
GRANT SELECT ON public.attendance_daily_summaries TO authenticated;
REVOKE ALL ON public.attendance_finalization_runs FROM anon, authenticated;
GRANT ALL ON public.attendance_schedule_rules, public.attendance_holidays,
  public.attendance_daily_summaries, public.attendance_finalization_runs TO service_role;

COMMIT;
