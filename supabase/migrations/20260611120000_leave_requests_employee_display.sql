-- Persist employee display fields on leave requests for reliable UI rendering.

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS employee_name TEXT,
  ADD COLUMN IF NOT EXISTS employee_username TEXT;

-- Backfill from employee_uid → users.uid (text)
UPDATE public.leave_requests lr
SET
  employee_name = COALESCE(lr.employee_name, u.name),
  employee_username = COALESCE(lr.employee_username, u.username)
FROM public.users u
WHERE u.uid = lr.employee_uid::text
  AND (lr.employee_name IS NULL OR lr.employee_username IS NULL);

-- Backfill from employee_id emp_<uid> when uid join missed
UPDATE public.leave_requests lr
SET
  employee_name = COALESCE(lr.employee_name, u.name),
  employee_username = COALESCE(lr.employee_username, u.username)
FROM public.users u
WHERE lr.employee_name IS NULL
  AND lr.employee_id LIKE 'emp\_%'
  AND u.uid = substring(lr.employee_id from 5);

COMMENT ON COLUMN public.leave_requests.employee_name IS
  'Snapshot of employee name at submission time; used for admin UI display.';
COMMENT ON COLUMN public.leave_requests.employee_username IS
  'Snapshot of employee username at submission time; used for admin UI display.';
