-- ============================================
-- Tickets Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  created_by_uid UUID NOT NULL,           -- auth.uid()
  created_by VARCHAR(255) NOT NULL,        -- username (display only)

  category VARCHAR(50) NOT NULL,            -- 'technical', 'hr', 'finance', 'facilities', 'other'
  priority VARCHAR(50) NOT NULL,            -- 'low', 'medium', 'high', 'urgent'
  subject TEXT NOT NULL,
  description TEXT NOT NULL,

  status VARCHAR(50) DEFAULT 'open',       -- 'open', 'in_progress', 'resolved', 'closed'

  assigned_to VARCHAR(255),                -- Username of manager/admin assigned

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  responses JSONB DEFAULT '[]'::jsonb       -- Array of response objects
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_tickets_created_by_uid
ON tickets(created_by_uid);

CREATE INDEX IF NOT EXISTS idx_tickets_status
ON tickets(status);

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to
ON tickets(assigned_to);

CREATE INDEX IF NOT EXISTS idx_tickets_category
ON tickets(category);

CREATE INDEX IF NOT EXISTS idx_tickets_created_at
ON tickets(created_at DESC);

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS: View own tickets
-- ============================================

CREATE POLICY "Users can view own tickets"
ON tickets
FOR SELECT
USING (
  created_by_uid = auth.uid()
);

-- ============================================
-- USERS: Create own tickets
-- ============================================

CREATE POLICY "Users can create own tickets"
ON tickets
FOR INSERT
WITH CHECK (
  created_by_uid = auth.uid()
);

-- ============================================
-- MANAGERS: View assigned tickets
-- ============================================

CREATE POLICY "Managers can view assigned tickets"
ON tickets
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid = auth.uid()::text
      AND users.username = tickets.assigned_to
      AND users.role IN ('manager', 'super_admin')
  )
);

-- ============================================
-- MANAGERS: View department tickets
-- ============================================

CREATE POLICY "Managers can view department tickets"
ON tickets
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND (
        -- Ticket category matches manager's department
        (tickets.category = 'engineering' AND manager.department = 'Engineering')
        OR (tickets.category = 'technical' AND manager.department = 'Technical')
        OR (tickets.category = 'hr' AND manager.department = 'HR')
        OR (tickets.category = 'finance' AND manager.department = 'Finance')
        OR (tickets.category = 'sales' AND manager.department = 'Sales')
        OR (tickets.category = 'facilities' AND manager.department = 'Facilities')
        -- Or ticket created by employee in manager's department
        OR EXISTS (
          SELECT 1
          FROM users employee
          WHERE employee.uid = tickets.created_by_uid::text
            AND employee.department = manager.department
        )
      )
  )
);

-- ============================================
-- SUPER ADMINS: View all tickets
-- ============================================

CREATE POLICY "Super admins can view all tickets"
ON tickets
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND role = 'super_admin'
  )
);

-- ============================================
-- MANAGERS & ADMINS: Update tickets
-- ============================================

CREATE POLICY "Managers and admins can update tickets"
ON tickets
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND (
        role = 'super_admin'
        OR username = tickets.assigned_to
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

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_tickets_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW
EXECUTE FUNCTION update_tickets_updated_at();

