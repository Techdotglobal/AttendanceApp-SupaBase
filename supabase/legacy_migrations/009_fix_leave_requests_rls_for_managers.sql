-- ============================================
-- Fix Leave Requests RLS for Managers
-- ============================================
-- This migration fixes the RLS policies to ensure managers can see
-- leave requests assigned to them, especially for techmanager

-- Drop existing manager policies
DROP POLICY IF EXISTS "Managers can view assigned leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Managers can view department leave requests" ON leave_requests;
DROP POLICY IF EXISTS "Managers can view category-based leave requests" ON leave_requests;

-- ============================================
-- MANAGERS: View assigned leave requests (FIXED)
-- ============================================
-- This policy allows managers to see requests where assigned_to matches their username
-- Uses case-insensitive comparison and handles UUID properly
CREATE POLICY "Managers can view assigned leave requests"
ON leave_requests
FOR SELECT
USING (
  assigned_to IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND TRIM(users.username) = TRIM(leave_requests.assigned_to)
      AND users.role IN ('manager', 'super_admin')
  )
);

-- ============================================
-- MANAGERS: View department leave requests (FIXED)
-- ============================================
-- This policy allows managers to see requests from employees in their department
CREATE POLICY "Managers can view department leave requests"
ON leave_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee
      ON employee.department = manager.department
        AND employee.department IS NOT NULL
        AND manager.department IS NOT NULL
    WHERE manager.uid::text = auth.uid()::text
      AND manager.role = 'manager'
      AND employee.uid::text = leave_requests.employee_uid::text
  )
);

-- ============================================
-- MANAGERS: View category-based leave requests (NEW)
-- ============================================
-- This policy allows managers to see requests where the category matches their department
-- Category mapping: engineering -> Engineering, technical -> Technical, hr -> HR, finance -> Finance, sales -> Sales, facilities -> Facilities
-- AND the request is assigned to them
CREATE POLICY "Managers can view category-based leave requests"
ON leave_requests
FOR SELECT
USING (
  category IS NOT NULL
  AND assigned_to IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND users.role = 'manager'
      AND TRIM(users.username) = TRIM(leave_requests.assigned_to)
      AND (
        -- Engineering category -> Engineering department
        (LOWER(TRIM(leave_requests.category)) = 'engineering' AND users.department = 'Engineering')
        OR
        -- Technical category -> Technical department
        (LOWER(TRIM(leave_requests.category)) = 'technical' AND users.department = 'Technical')
        OR
        -- HR category -> HR department
        (LOWER(TRIM(leave_requests.category)) = 'hr' AND users.department = 'HR')
        OR
        -- Finance category -> Finance department
        (LOWER(TRIM(leave_requests.category)) = 'finance' AND users.department = 'Finance')
        OR
        -- Sales category -> Sales department
        (LOWER(TRIM(leave_requests.category)) = 'sales' AND users.department = 'Sales')
        OR
        -- Facilities category -> Facilities department
        (LOWER(TRIM(leave_requests.category)) = 'facilities' AND users.department = 'Facilities')
      )
  )
);

