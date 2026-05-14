-- ============================================
-- Add HR Admin Access to Attendance Records
-- ============================================
-- This migration adds RLS policies to allow HR managers (role='manager' AND department='HR')
-- to view all attendance records, similar to super_admin privileges for HR domain features.
-- HR admins should NOT have full super_admin powers, only HR/people-management features.
-- ============================================

-- ============================================
-- HR ADMINS: View all attendance records
-- ============================================
-- HR managers (role='manager' AND department='HR') can view all attendance records
-- This grants HR elevated privileges for attendance viewing while maintaining
-- that super_admin remains the highest authority

CREATE POLICY "HR admins can view all attendance records"
ON attendance_records
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND role = 'manager'
      AND department = 'HR'
  )
);

-- ============================================
-- HR ADMINS: Update attendance records for all employees
-- ============================================
-- HR managers can update attendance records for all employees (except super_admins)

CREATE POLICY "HR admins can update attendance records"
ON attendance_records
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users hr_admin
    WHERE hr_admin.uid = auth.uid()::text
      AND hr_admin.role = 'manager'
      AND hr_admin.department = 'HR'
      AND EXISTS (
        SELECT 1
        FROM users employee
        WHERE employee.uid = attendance_records.user_uid::text
          AND employee.role != 'super_admin'
      )
  )
);

-- ============================================
-- HR ADMINS: Delete attendance records for all employees
-- ============================================
-- HR managers can delete attendance records for all employees (except super_admins)

CREATE POLICY "HR admins can delete attendance records"
ON attendance_records
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users hr_admin
    WHERE hr_admin.uid = auth.uid()::text
      AND hr_admin.role = 'manager'
      AND hr_admin.department = 'HR'
      AND EXISTS (
        SELECT 1
        FROM users employee
        WHERE employee.uid = attendance_records.user_uid::text
          AND employee.role != 'super_admin'
      )
  )
);

-- ============================================
-- HR ADMINS: Create manual attendance records for all employees
-- ============================================
-- HR managers can create manual attendance records for all employees (except super_admins)

CREATE POLICY "HR admins can create manual attendance records"
ON attendance_records
FOR INSERT
WITH CHECK (
  is_manual = true
  AND EXISTS (
    SELECT 1
    FROM users hr_admin
    WHERE hr_admin.uid = auth.uid()::text
      AND hr_admin.role = 'manager'
      AND hr_admin.department = 'HR'
      AND EXISTS (
        SELECT 1
        FROM users employee
        WHERE employee.uid = attendance_records.user_uid::text
          AND employee.role != 'super_admin'
      )
  )
);

