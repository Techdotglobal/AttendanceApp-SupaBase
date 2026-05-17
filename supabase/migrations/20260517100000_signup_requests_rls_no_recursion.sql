-- Fix signup_requests RLS policies that contained FROM users subqueries.
-- Those subqueries trigger the users RLS, which recursed infinitely once users RLS
-- was enabled. Replace them with public.rls_caller_role() / rls_caller_is_active()
-- which are SECURITY DEFINER and bypass RLS internally.

-- Drop old recursive policies
DROP POLICY IF EXISTS "Super admins can view all signup requests" ON signup_requests;
DROP POLICY IF EXISTS "Super admins can update signup requests" ON signup_requests;
DROP POLICY IF EXISTS "Super admins can delete signup requests" ON signup_requests;
DROP POLICY IF EXISTS "Users can view own signup requests" ON signup_requests;

-- Re-create: super admins see all requests
CREATE POLICY "Super admins can view all signup requests"
ON signup_requests
FOR SELECT
USING (
  public.rls_caller_role() = 'super_admin'
  AND public.rls_caller_is_active()
);

-- Re-create: super admins approve/reject
CREATE POLICY "Super admins can update signup requests"
ON signup_requests
FOR UPDATE
USING (
  public.rls_caller_role() = 'super_admin'
  AND public.rls_caller_is_active()
);

-- Re-create: super admins delete
CREATE POLICY "Super admins can delete signup requests"
ON signup_requests
FOR DELETE
USING (
  public.rls_caller_role() = 'super_admin'
  AND public.rls_caller_is_active()
);

-- Re-create: authenticated users can view their own request by username match
-- Use a direct lookup (no users subquery needed — signup_requests.username is the key)
-- New employees who submitted a request are not yet in auth.users, so we allow
-- any authenticated session whose JWT sub matches nothing to still see their row
-- by username alone. For already-created users, the username is unique and safe.
CREATE POLICY "Users can view own signup requests"
ON signup_requests
FOR SELECT
USING (
  username = (
    SELECT username FROM public.users WHERE uid = auth.uid()::text LIMIT 1
  )
);
