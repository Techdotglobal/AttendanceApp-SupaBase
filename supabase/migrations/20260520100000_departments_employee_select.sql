-- Allow employees to read departments in their company (for client-side fallback / future direct queries).
-- Primary listing still goes through auth-service GET /api/auth/departments.

DROP POLICY IF EXISTS "departments_employee_select_own_company" ON public.departments;

CREATE POLICY "departments_employee_select_own_company"
ON public.departments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'employee'
      AND u.is_active = true
      AND u.company_id = departments.company_id
  )
);
