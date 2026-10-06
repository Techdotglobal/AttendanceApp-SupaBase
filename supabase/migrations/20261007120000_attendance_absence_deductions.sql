-- Attendance absence detection and reversible leave-balance deductions.
-- Additive only: no attendance, leave-request, or existing balance rows are
-- rewritten and no historical summaries/outcomes are backfilled.

BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_absence_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  action text NOT NULL DEFAULT 'NONE'
    CHECK (action IN ('NONE', 'DEDUCT_LEAVE', 'UNPAID_ABSENCE')),
  leave_type text
    CHECK (leave_type IS NULL OR leave_type IN ('annual', 'sick', 'casual')),
  deduction_days numeric(6,2) NOT NULL DEFAULT 1
    CHECK (deduction_days >= 0),
  insufficient_balance_policy text NOT NULL DEFAULT 'CAP_AT_ZERO_UNPAID'
    CHECK (insufficient_balance_policy IN ('CAP_AT_ZERO_UNPAID', 'ALLOW_NEGATIVE', 'NO_DEDUCTION')),
  effective_from date,
  updated_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id),
  CONSTRAINT attendance_absence_policy_action_check CHECK (
    action <> 'DEDUCT_LEAVE'
    OR (leave_type IS NOT NULL AND deduction_days > 0)
  )
);

CREATE TABLE IF NOT EXISTS public.attendance_absence_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  summary_id uuid NOT NULL REFERENCES public.attendance_daily_summaries(id) ON DELETE RESTRICT,
  user_uid text NOT NULL,
  work_date date NOT NULL,
  status text NOT NULL CHECK (status IN (
    'NO_ACTION', 'UNPAID', 'DEDUCTED', 'PARTIALLY_DEDUCTED', 'RECONCILED', 'REVERSED'
  )),
  reason text NOT NULL DEFAULT 'SCHEDULED_WORKDAY_WITHOUT_ATTENDANCE',
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (requested_days >= 0),
  deducted_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (deducted_days >= 0),
  unpaid_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (unpaid_days >= 0),
  leave_type text CHECK (leave_type IS NULL OR leave_type IN ('annual', 'sick', 'casual')),
  original_balance numeric(12,2),
  resulting_balance numeric(12,2),
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'manual')),
  reconciliation_reason text,
  reconciled_at timestamptz,
  reconciled_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  decision_version integer NOT NULL DEFAULT 1 CHECK (decision_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, summary_id)
);

CREATE INDEX IF NOT EXISTS attendance_absence_outcomes_company_date_idx
  ON public.attendance_absence_outcomes(company_id, work_date DESC);
CREATE INDEX IF NOT EXISTS attendance_absence_outcomes_user_date_idx
  ON public.attendance_absence_outcomes(user_uid, work_date DESC);

CREATE TABLE IF NOT EXISTS public.leave_balance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outcome_id uuid NOT NULL REFERENCES public.attendance_absence_outcomes(id) ON DELETE RESTRICT,
  user_uid text NOT NULL,
  leave_type text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'casual')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  transaction_type text NOT NULL CHECK (transaction_type IN ('ABSENCE_DEDUCTION', 'ABSENCE_REVERSAL')),
  cycle integer NOT NULL DEFAULT 1 CHECK (cycle > 0),
  original_balance numeric(12,2) NOT NULL,
  resulting_balance numeric(12,2) NOT NULL,
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'manual')),
  reversal_of_id uuid REFERENCES public.leave_balance_adjustments(id),
  created_by_uid text REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outcome_id, cycle, transaction_type)
);

CREATE INDEX IF NOT EXISTS leave_balance_adjustments_company_user_idx
  ON public.leave_balance_adjustments(company_id, user_uid, leave_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.attendance_absence_company_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary_company uuid;
  v_summary_user text;
  v_user_company uuid;
  v_outcome_company uuid;
  v_outcome_user text;
  v_actor_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'attendance_absence_policies' THEN
    IF NEW.updated_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.updated_by_uid;
      IF v_actor_company IS NULL OR v_actor_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'absence policy actor must belong to its company';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_absence_outcomes' THEN
    SELECT company_id, user_uid INTO v_summary_company, v_summary_user
      FROM public.attendance_daily_summaries WHERE id = NEW.summary_id;
    IF v_summary_company IS NULL OR v_summary_company IS DISTINCT FROM NEW.company_id
       OR v_summary_user IS DISTINCT FROM NEW.user_uid THEN
      RAISE EXCEPTION 'absence outcome summary must belong to its company and user';
    END IF;
    SELECT company_id INTO v_user_company FROM public.users WHERE uid = NEW.user_uid;
    IF v_user_company IS NULL OR v_user_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'absence outcome user must belong to its company';
    END IF;
    IF NEW.reconciled_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.reconciled_by_uid;
      IF v_actor_company IS NULL OR v_actor_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'absence reconciliation actor must belong to its company';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_balance_adjustments' THEN
    SELECT company_id, user_uid INTO v_outcome_company, v_outcome_user
      FROM public.attendance_absence_outcomes WHERE id = NEW.outcome_id;
    IF v_outcome_company IS NULL OR v_outcome_company IS DISTINCT FROM NEW.company_id
       OR v_outcome_user IS DISTINCT FROM NEW.user_uid THEN
      RAISE EXCEPTION 'leave adjustment outcome must belong to its company and user';
    END IF;
    SELECT company_id INTO v_user_company FROM public.users WHERE uid = NEW.user_uid;
    IF v_user_company IS NULL OR v_user_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'leave adjustment user must belong to its company';
    END IF;
    IF NEW.created_by_uid IS NOT NULL THEN
      SELECT company_id INTO v_actor_company FROM public.users WHERE uid = NEW.created_by_uid;
      IF v_actor_company IS NULL OR v_actor_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'leave adjustment actor must belong to its company';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_absence_policies_company_guard ON public.attendance_absence_policies;
CREATE TRIGGER attendance_absence_policies_company_guard
BEFORE INSERT OR UPDATE ON public.attendance_absence_policies
FOR EACH ROW EXECUTE FUNCTION public.attendance_absence_company_guard();

DROP TRIGGER IF EXISTS attendance_absence_outcomes_company_guard ON public.attendance_absence_outcomes;
CREATE TRIGGER attendance_absence_outcomes_company_guard
BEFORE INSERT OR UPDATE ON public.attendance_absence_outcomes
FOR EACH ROW EXECUTE FUNCTION public.attendance_absence_company_guard();

DROP TRIGGER IF EXISTS leave_balance_adjustments_company_guard ON public.leave_balance_adjustments;
CREATE TRIGGER leave_balance_adjustments_company_guard
BEFORE INSERT OR UPDATE ON public.leave_balance_adjustments
FOR EACH ROW EXECUTE FUNCTION public.attendance_absence_company_guard();

CREATE OR REPLACE FUNCTION public.prevent_leave_balance_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'leave balance adjustments are immutable';
END;
$$;

DROP TRIGGER IF EXISTS leave_balance_adjustments_immutable ON public.leave_balance_adjustments;
CREATE TRIGGER leave_balance_adjustments_immutable
BEFORE UPDATE OR DELETE ON public.leave_balance_adjustments
FOR EACH ROW EXECUTE FUNCTION public.prevent_leave_balance_adjustment_mutation();

CREATE OR REPLACE FUNCTION public.prevent_absence_snapshot_history_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT (NEW.policy_snapshot_history @> OLD.policy_snapshot_history) THEN
    RAISE EXCEPTION 'absence policy snapshot history is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_absence_snapshot_history_guard ON public.attendance_absence_outcomes;
CREATE TRIGGER attendance_absence_snapshot_history_guard
BEFORE UPDATE ON public.attendance_absence_outcomes
FOR EACH ROW EXECUTE FUNCTION public.prevent_absence_snapshot_history_rewrite();

CREATE OR REPLACE FUNCTION public.apply_attendance_absence_outcome(
  p_company_id uuid,
  p_summary_id uuid,
  p_user_uid text,
  p_work_date date,
  p_policy jsonb,
  p_source text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary public.attendance_daily_summaries%ROWTYPE;
  v_outcome public.attendance_absence_outcomes%ROWTYPE;
  v_policy_action text := upper(COALESCE(p_policy->>'action', 'NONE'));
  v_leave_type text := lower(NULLIF(p_policy->>'leave_type', ''));
  v_insufficient text := upper(COALESCE(p_policy->>'insufficient_balance_policy', 'CAP_AT_ZERO_UNPAID'));
  v_requested numeric := GREATEST(COALESCE((p_policy->>'deduction_days')::numeric, 1), 0);
  v_allocated numeric := 0;
  v_approved numeric := 0;
  v_existing_adjustments numeric := 0;
  v_original numeric := 0;
  v_deducted numeric := 0;
  v_unpaid numeric := 0;
  v_resulting numeric := 0;
  v_cycle integer := 1;
  v_has_outcome boolean := false;
  v_user_uuid uuid;
  v_custom_annual numeric;
  v_custom_sick numeric;
  v_custom_casual numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'absence outcome is service-role only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_summary
    FROM public.attendance_daily_summaries
   WHERE id = p_summary_id AND company_id = p_company_id
     AND user_uid = p_user_uid AND work_date = p_work_date
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attendance summary not found'; END IF;
  IF v_summary.status <> 'ABSENT' OR v_summary.absence_eligible IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'attendance summary is not absence-eligible';
  END IF;

  SELECT * INTO v_outcome
    FROM public.attendance_absence_outcomes
   WHERE company_id = p_company_id AND summary_id = p_summary_id
   FOR UPDATE;
  v_has_outcome := FOUND;

  IF v_has_outcome AND v_outcome.status NOT IN ('RECONCILED', 'REVERSED') THEN
    RETURN to_jsonb(v_outcome);
  END IF;
  IF v_has_outcome THEN v_cycle := v_outcome.decision_version + 1; END IF;

  IF v_policy_action = 'NONE' THEN
    v_deducted := 0; v_unpaid := 0;
  ELSIF v_policy_action = 'UNPAID_ABSENCE' THEN
    v_deducted := 0; v_unpaid := v_requested;
  ELSIF v_policy_action = 'DEDUCT_LEAVE' THEN
    IF v_leave_type IS NULL OR v_leave_type NOT IN ('annual', 'sick', 'casual') OR v_requested <= 0 THEN
      RAISE EXCEPTION 'invalid absence deduction policy';
    END IF;

    IF p_user_uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_user_uuid := p_user_uid::uuid;
      SELECT annual_leaves, sick_leaves, casual_leaves INTO v_custom_annual, v_custom_sick, v_custom_casual
        FROM public.leave_balances
       WHERE user_uid = v_user_uuid AND company_id = p_company_id FOR UPDATE;
      SELECT COALESCE(SUM(days), 0) INTO v_approved FROM public.leave_requests
       WHERE employee_uid = v_user_uuid AND company_id = p_company_id
         AND leave_type = v_leave_type AND status = 'approved';
      SELECT COALESCE(SUM(amount), 0) INTO v_existing_adjustments FROM public.leave_balance_adjustments
       WHERE user_uid = p_user_uid AND company_id = p_company_id AND leave_type = v_leave_type;
      v_allocated := CASE v_leave_type
        WHEN 'annual' THEN COALESCE(v_custom_annual, (SELECT default_annual_leaves FROM public.leave_settings WHERE company_id = p_company_id), 20)
        WHEN 'sick' THEN COALESCE(v_custom_sick, (SELECT default_sick_leaves FROM public.leave_settings WHERE company_id = p_company_id), 10)
        ELSE COALESCE(v_custom_casual, (SELECT default_casual_leaves FROM public.leave_settings WHERE company_id = p_company_id), 5)
      END;
    END IF;
    v_original := v_allocated - v_approved - v_existing_adjustments;
    IF v_insufficient = 'ALLOW_NEGATIVE' THEN
      v_deducted := v_requested;
      v_unpaid := 0;
    ELSIF v_insufficient = 'NO_DEDUCTION' OR v_user_uuid IS NULL THEN
      v_deducted := 0;
      v_unpaid := v_requested;
    ELSE
      v_deducted := LEAST(v_requested, GREATEST(v_original, 0));
      v_unpaid := GREATEST(v_requested - v_deducted, 0);
    END IF;
    v_resulting := v_original - v_deducted;
  ELSE
    RAISE EXCEPTION 'invalid absence action';
  END IF;

  IF v_has_outcome THEN
    UPDATE public.attendance_absence_outcomes SET
      status = CASE WHEN v_deducted = 0 AND v_unpaid = 0 THEN 'NO_ACTION'
                    WHEN v_deducted = 0 THEN 'UNPAID'
                    WHEN v_unpaid > 0 THEN 'PARTIALLY_DEDUCTED' ELSE 'DEDUCTED' END,
      policy_snapshot = p_policy,
      policy_snapshot_history = COALESCE(v_outcome.policy_snapshot_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'decision_version', v_outcome.decision_version,
        'policy_snapshot', v_outcome.policy_snapshot,
        'status', v_outcome.status,
        'requested_days', v_outcome.requested_days,
        'deducted_days', v_outcome.deducted_days,
        'unpaid_days', v_outcome.unpaid_days,
        'original_balance', v_outcome.original_balance,
        'resulting_balance', v_outcome.resulting_balance
      )),
      requested_days = v_requested,
      deducted_days = v_deducted, unpaid_days = v_unpaid,
      leave_type = v_leave_type, original_balance = v_original,
      resulting_balance = v_resulting, source = p_source,
      reconciliation_reason = NULL, reconciled_at = NULL, reconciled_by_uid = NULL,
      decision_version = v_cycle, updated_at = now()
    WHERE id = v_outcome.id RETURNING * INTO v_outcome;
  ELSE
    INSERT INTO public.attendance_absence_outcomes (
      company_id, summary_id, user_uid, work_date, status, policy_snapshot,
      requested_days, deducted_days, unpaid_days, leave_type,
      original_balance, resulting_balance, source, decision_version
    ) VALUES (
      p_company_id, p_summary_id, p_user_uid, p_work_date,
      CASE WHEN v_deducted = 0 AND v_unpaid = 0 THEN 'NO_ACTION'
           WHEN v_deducted = 0 THEN 'UNPAID'
           WHEN v_unpaid > 0 THEN 'PARTIALLY_DEDUCTED' ELSE 'DEDUCTED' END,
      p_policy, v_requested, v_deducted, v_unpaid, v_leave_type,
      v_original, v_resulting, p_source, v_cycle
    ) RETURNING * INTO v_outcome;
  END IF;

  IF v_deducted > 0 THEN
    INSERT INTO public.leave_balance_adjustments (
      company_id, outcome_id, user_uid, leave_type, amount, transaction_type,
      cycle, original_balance, resulting_balance, reason, source
    ) VALUES (
      p_company_id, v_outcome.id, p_user_uid, v_leave_type, v_deducted,
      'ABSENCE_DEDUCTION', v_cycle, v_original, v_resulting,
      'Automatic absence deduction', p_source
    );
  END IF;
  RETURN to_jsonb(v_outcome);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_attendance_absence_outcome(
  p_company_id uuid,
  p_summary_id uuid,
  p_reason text,
  p_actor_uid text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outcome public.attendance_absence_outcomes%ROWTYPE;
  v_adjustment public.leave_balance_adjustments%ROWTYPE;
  v_resulting numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'absence reconciliation is service-role only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_outcome FROM public.attendance_absence_outcomes
   WHERE company_id = p_company_id AND summary_id = p_summary_id FOR UPDATE;
  IF NOT FOUND OR v_outcome.status IN ('RECONCILED', 'REVERSED') THEN
    RETURN CASE WHEN FOUND THEN to_jsonb(v_outcome) ELSE NULL END;
  END IF;
  SELECT * INTO v_adjustment FROM public.leave_balance_adjustments
   WHERE outcome_id = v_outcome.id AND cycle = v_outcome.decision_version
     AND transaction_type = 'ABSENCE_DEDUCTION' FOR UPDATE;
  IF FOUND THEN
    v_resulting := v_adjustment.resulting_balance + v_adjustment.amount;
    INSERT INTO public.leave_balance_adjustments (
      company_id, outcome_id, user_uid, leave_type, amount, transaction_type,
      cycle, original_balance, resulting_balance, reason, source, reversal_of_id,
      created_by_uid
    ) VALUES (
      p_company_id, v_outcome.id, v_outcome.user_uid, v_outcome.leave_type,
      -v_adjustment.amount, 'ABSENCE_REVERSAL', v_outcome.decision_version,
      v_adjustment.resulting_balance, v_resulting, p_reason,
      CASE WHEN p_actor_uid IS NULL THEN 'system' ELSE 'manual' END,
      v_adjustment.id, p_actor_uid
    );
  END IF;
  UPDATE public.attendance_absence_outcomes SET
    status = 'RECONCILED', reconciliation_reason = p_reason,
    reconciled_at = now(), reconciled_by_uid = p_actor_uid,
    updated_at = now(), decision_version = decision_version + 1
   WHERE id = v_outcome.id RETURNING * INTO v_outcome;
  RETURN to_jsonb(v_outcome);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_leave_balance(p_user_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_custom_annual numeric;
  v_custom_sick numeric;
  v_custom_casual numeric;
  v_is_custom boolean := false;
  v_annual_used numeric := 0;
  v_sick_used numeric := 0;
  v_casual_used numeric := 0;
  v_annual_adjusted numeric := 0;
  v_sick_adjusted numeric := 0;
  v_casual_adjusted numeric := 0;
  v_annual_allocation numeric := 20;
  v_sick_allocation numeric := 10;
  v_casual_allocation numeric := 5;
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() IS DISTINCT FROM p_user_uid THEN
    RAISE EXCEPTION 'own balance only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT company_id INTO v_company_id FROM public.users WHERE uid = p_user_uid::text AND is_active = true;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'active employee not found'; END IF;
  SELECT annual_leaves, sick_leaves, casual_leaves, is_custom
    INTO v_custom_annual, v_custom_sick, v_custom_casual, v_is_custom
    FROM public.leave_balances
   WHERE user_uid = p_user_uid AND company_id = v_company_id;
  SELECT COALESCE(default_annual_leaves, 20), COALESCE(default_sick_leaves, 10), COALESCE(default_casual_leaves, 5)
    INTO v_annual_allocation, v_sick_allocation, v_casual_allocation
    FROM public.leave_settings WHERE company_id = v_company_id;
  SELECT COALESCE(SUM(days), 0) INTO v_annual_used FROM public.leave_requests
    WHERE employee_uid = p_user_uid AND company_id = v_company_id AND leave_type = 'annual' AND status = 'approved';
  SELECT COALESCE(SUM(days), 0) INTO v_sick_used FROM public.leave_requests
    WHERE employee_uid = p_user_uid AND company_id = v_company_id AND leave_type = 'sick' AND status = 'approved';
  SELECT COALESCE(SUM(days), 0) INTO v_casual_used FROM public.leave_requests
    WHERE employee_uid = p_user_uid AND company_id = v_company_id AND leave_type = 'casual' AND status = 'approved';
  SELECT COALESCE(SUM(amount) FILTER (WHERE leave_type = 'annual'), 0),
         COALESCE(SUM(amount) FILTER (WHERE leave_type = 'sick'), 0),
         COALESCE(SUM(amount) FILTER (WHERE leave_type = 'casual'), 0)
    INTO v_annual_adjusted, v_sick_adjusted, v_casual_adjusted
    FROM public.leave_balance_adjustments
   WHERE company_id = v_company_id AND user_uid = p_user_uid::text;
  RETURN jsonb_build_object(
    'annualLeaves', COALESCE(v_custom_annual, v_annual_allocation, 20),
    'sickLeaves', COALESCE(v_custom_sick, v_sick_allocation, 10),
    'casualLeaves', COALESCE(v_custom_casual, v_casual_allocation, 5),
    'usedAnnualLeaves', v_annual_used + v_annual_adjusted,
    'usedSickLeaves', v_sick_used + v_sick_adjusted,
    'usedCasualLeaves', v_casual_used + v_casual_adjusted,
    'isCustom', COALESCE(v_is_custom, false),
    'companyId', v_company_id
  );
END;
$$;

REVOKE ALL ON public.attendance_absence_policies,
  public.attendance_absence_outcomes, public.leave_balance_adjustments
  FROM anon, authenticated;
GRANT ALL ON public.attendance_absence_policies,
  public.attendance_absence_outcomes, public.leave_balance_adjustments
  TO service_role;
ALTER TABLE public.attendance_absence_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_absence_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balance_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.apply_attendance_absence_outcome(uuid, uuid, text, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_attendance_absence_outcome(uuid, uuid, text, date, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_attendance_absence_outcome(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_attendance_absence_outcome(uuid, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_effective_leave_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_leave_balance(uuid) TO authenticated, service_role;

COMMIT;
