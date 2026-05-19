-- Allow managers and super_admins to manage per-company leave_settings (was super_admin only).
-- Aligns with leave_balances admin policies.

BEGIN;

DROP POLICY IF EXISTS "Super admins manage leave settings" ON public.leave_settings;
DROP POLICY IF EXISTS "Super admins update leave settings" ON public.leave_settings;

CREATE POLICY "Admins insert leave settings"
ON public.leave_settings
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('super_admin', 'manager')
      AND actor.is_active = true
      AND actor.company_id = leave_settings.company_id
  )
);

CREATE POLICY "Admins update leave settings"
ON public.leave_settings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('super_admin', 'manager')
      AND actor.is_active = true
      AND actor.company_id = leave_settings.company_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users actor
    WHERE actor.uid = auth.uid()::text
      AND actor.role IN ('super_admin', 'manager')
      AND actor.is_active = true
      AND actor.company_id = leave_settings.company_id
  )
);

COMMENT ON TABLE public.leave_settings IS
  'Per-company leave allocation defaults. One row per company. Super_admin and manager can manage within their company.';

COMMIT;
