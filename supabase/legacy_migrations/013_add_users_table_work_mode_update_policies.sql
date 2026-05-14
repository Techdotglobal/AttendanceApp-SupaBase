-- ============================================
-- Add RLS Policies for Updating work_mode in users table
-- ============================================
-- This migration adds RLS policies to allow managers and admins
-- to update work_mode for employees based on their permissions.
-- ============================================

-- ============================================
-- SUPER ADMINS: Update work_mode for all users
-- ============================================

CREATE POLICY "Super admins can update work_mode for all users"
ON users
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users updater
    WHERE updater.uid = auth.uid()::text
      AND updater.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users updater
    WHERE updater.uid = auth.uid()::text
      AND updater.role = 'super_admin'
  )
);

-- ============================================
-- HR MANAGERS: Update work_mode for all non-super_admin users
-- ============================================
-- HR managers (role='manager' AND department='HR') can update work_mode
-- for all employees except super_admins

CREATE POLICY "HR managers can update work_mode for all employees"
ON users
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users hr_manager
    WHERE hr_manager.uid = auth.uid()::text
      AND hr_manager.role = 'manager'
      AND hr_manager.department = 'HR'
      AND users.role != 'super_admin'  -- Cannot update super_admins
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users hr_manager
    WHERE hr_manager.uid = auth.uid()::text
      AND hr_manager.role = 'manager'
      AND hr_manager.department = 'HR'
      AND users.role != 'super_admin'  -- Cannot update super_admins
  )
);

-- ============================================
-- MANAGERS: Update work_mode for employees in their department
-- ============================================
-- Regular managers can only update work_mode for employees
-- in their own department (not super_admins)

CREATE POLICY "Managers can update work_mode for department employees"
ON users
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND users.department = manager.department
      AND users.role != 'super_admin'  -- Cannot update super_admins
      AND users.role != 'manager'  -- Cannot update other managers
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users manager
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND users.department = manager.department
      AND users.role != 'super_admin'  -- Cannot update super_admins
      AND users.role != 'manager'  -- Cannot update other managers
  )
);

-- ============================================
-- USERS: Update own work_mode
-- ============================================
-- Users can update their own work_mode

CREATE POLICY "Users can update own work_mode"
ON users
FOR UPDATE
USING (uid = auth.uid()::text)
WITH CHECK (uid = auth.uid()::text);

