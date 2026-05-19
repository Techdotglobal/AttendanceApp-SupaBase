-- OPTIONAL: Run only if you no longer need self-service signup request data.
-- The Hadir.AI mobile app no longer uses signup_requests (admins use Create User instead).
-- Review and backup data before executing in production.

-- DROP POLICY IF EXISTS "Users can view own signup requests" ON public.signup_requests;
-- DROP POLICY IF EXISTS "Anyone can create signup requests" ON public.signup_requests;
-- DROP POLICY IF EXISTS "Super admins can view all signup requests" ON public.signup_requests;
-- DROP POLICY IF EXISTS "Super admins can update signup requests" ON public.signup_requests;
-- DROP POLICY IF EXISTS "Super admins can delete signup requests" ON public.signup_requests;
-- (Add any tenant-scoped policies from 20260517100000_signup_requests_rls_no_recursion.sql)

-- DROP TRIGGER IF EXISTS trigger_update_signup_requests_updated_at ON public.signup_requests;
-- DROP TABLE IF EXISTS public.signup_requests CASCADE;
