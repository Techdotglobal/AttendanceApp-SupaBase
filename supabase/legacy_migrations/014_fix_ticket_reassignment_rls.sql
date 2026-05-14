-- ============================================
-- Fix Ticket Reassignment RLS Policies
-- ============================================
-- This migration updates the RLS policy for ticket updates
-- to allow HR managers to reassign any ticket
-- ============================================

-- Drop the existing policy
DROP POLICY IF EXISTS "Managers and admins can update tickets" ON tickets;

-- ============================================
-- MANAGERS & ADMINS: Update tickets
-- ============================================
-- Allows:
-- - Super admins: Update any ticket
-- - HR managers: Update any ticket (can reassign any ticket)
-- - Current assignee: Update tickets assigned to them
-- - Department managers: Update tickets in their department scope

CREATE POLICY "Managers and admins can update tickets"
ON tickets
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND (
        -- Super admins can update any ticket
        role = 'super_admin'
        -- Current assignee can update their assigned tickets
        OR username = tickets.assigned_to
        -- HR managers can update any ticket (special privilege)
        OR (
          role = 'manager'
          AND department = 'HR'
        )
        -- Other managers can update tickets in their department scope
        OR (
          role = 'manager'
          AND (
            -- Ticket category matches manager's department
            (tickets.category = 'engineering' AND department = 'Engineering')
            OR (tickets.category = 'technical' AND department = 'Technical')
            OR (tickets.category = 'hr' AND department = 'HR')
            OR (tickets.category = 'finance' AND department = 'Finance')
            OR (tickets.category = 'sales' AND department = 'Sales')
            OR (tickets.category = 'facilities' AND department = 'Facilities')
            -- Or ticket created by employee in manager's department
            OR EXISTS (
              SELECT 1
              FROM users employee
              WHERE employee.uid = tickets.created_by_uid::text
                AND employee.department = (
                  SELECT department FROM users WHERE uid = auth.uid()::text
                )
            )
          )
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND (
        -- Super admins can update any ticket
        role = 'super_admin'
        -- Current assignee can update their assigned tickets
        OR username = tickets.assigned_to
        -- HR managers can update any ticket (special privilege)
        OR (
          role = 'manager'
          AND department = 'HR'
        )
        -- Other managers can update tickets in their department scope
        OR (
          role = 'manager'
          AND (
            -- Ticket category matches manager's department
            (tickets.category = 'engineering' AND department = 'Engineering')
            OR (tickets.category = 'technical' AND department = 'Technical')
            OR (tickets.category = 'hr' AND department = 'HR')
            OR (tickets.category = 'finance' AND department = 'Finance')
            OR (tickets.category = 'sales' AND department = 'Sales')
            OR (tickets.category = 'facilities' AND department = 'Facilities')
            -- Or ticket created by employee in manager's department
            OR EXISTS (
              SELECT 1
              FROM users employee
              WHERE employee.uid = tickets.created_by_uid::text
                AND employee.department = (
                  SELECT department FROM users WHERE uid = auth.uid()::text
                )
            )
          )
        )
      )
  )
);

