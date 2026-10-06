-- Read-only Phase 3 preflight checks. Run manually against a staging or
-- production database before applying the migration. This file contains no
-- INSERT, UPDATE, DELETE, DDL, or RPC calls.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'attendance_records'
ORDER BY ordinal_position;

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.attendance_records'::regclass
  AND NOT tgisinternal;

SELECT ar.id, ar.user_uid, ar.company_id, u.company_id AS user_company_id
FROM public.attendance_records ar
LEFT JOIN public.users u ON u.uid::text = ar.user_uid::text
WHERE u.uid IS NULL OR ar.company_id IS DISTINCT FROM u.company_id;

SELECT user_uid, COUNT(*) AS primary_count
FROM public.user_department_assignments
WHERE is_active = true AND is_primary = true
GROUP BY user_uid
HAVING COUNT(*) > 1;

SELECT s.id, s.company_id, s.user_uid, s.calculation_snapshot
FROM public.attendance_daily_summaries s
LEFT JOIN public.users u ON u.uid = s.user_uid
WHERE u.uid IS NULL
   OR u.company_id IS DISTINCT FROM s.company_id
   OR s.calculation_snapshot IS NULL
   OR s.calculation_snapshot = '{}'::jsonb;

SELECT a.id AS rule_a, b.id AS rule_b, a.company_id, a.scope_type
FROM public.attendance_schedule_rules a
JOIN public.attendance_schedule_rules b
  ON a.id < b.id
 AND a.company_id = b.company_id
 AND a.scope_type = b.scope_type
 AND a.department_id IS NOT DISTINCT FROM b.department_id
 AND a.user_uid IS NOT DISTINCT FROM b.user_uid
 AND daterange(a.effective_from, COALESCE(a.effective_to, 'infinity'::date), '[]')
     && daterange(b.effective_from, COALESCE(b.effective_to, 'infinity'::date), '[]');

SELECT *
FROM public.attendance_schedule_rules
WHERE scope_type NOT IN ('COMPANY', 'DEPARTMENT', 'USER')
   OR (scope_type = 'COMPANY' AND (department_id IS NOT NULL OR user_uid IS NOT NULL))
   OR (scope_type = 'DEPARTMENT' AND department_id IS NULL)
   OR (scope_type = 'USER' AND user_uid IS NULL)
   OR (effective_to IS NOT NULL AND effective_to < effective_from);

SELECT auto_checkout_checkin_id, COUNT(*)
FROM public.attendance_records
WHERE checkout_source = 'automatic_schedule'
  AND auto_checkout_checkin_id IS NOT NULL
GROUP BY auto_checkout_checkin_id
HAVING COUNT(*) > 1;

SELECT policyname, tablename, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'attendance_schedule_rules',
    'attendance_holidays',
    'attendance_daily_summaries',
    'attendance_finalization_runs'
  );
