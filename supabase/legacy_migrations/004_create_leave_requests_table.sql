-- ============================================
-- Leave Requests Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  employee_uid UUID NOT NULL,           -- auth.uid()
  employee_id VARCHAR(255) NOT NULL,    -- username (display only)

  leave_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(3,1) NOT NULL,

  is_half_day BOOLEAN DEFAULT false,
  half_day_period VARCHAR(20),

  reason TEXT,
  category VARCHAR(50),

  status VARCHAR(50) DEFAULT 'pending',

  assigned_to VARCHAR(255),

  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by VARCHAR(255),
  admin_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_leave_employee_uid
ON leave_requests(employee_uid);

CREATE INDEX IF NOT EXISTS idx_leave_status
ON leave_requests(status);

CREATE INDEX IF NOT EXISTS idx_leave_assigned_to
ON leave_requests(assigned_to);

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS: View own leave requests
-- ============================================

CREATE POLICY "Users can view own leave requests"
ON leave_requests
FOR SELECT
USING (
  employee_uid = auth.uid()
);

-- ============================================
-- USERS: Create own leave requests
-- ============================================

CREATE POLICY "Users can create own leave requests"
ON leave_requests
FOR INSERT
WITH CHECK (
  employee_uid = auth.uid()
);

-- ============================================
-- MANAGERS: View assigned leave requests
-- ============================================

CREATE POLICY "Managers can view assigned leave requests"
ON leave_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid = auth.uid()::text
      AND users.username = leave_requests.assigned_to
      AND users.role IN ('manager', 'super_admin')
  )
);

-- ============================================
-- MANAGERS: View department leave requests
-- ============================================

CREATE POLICY "Managers can view department leave requests"
ON leave_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee
      ON employee.department = manager.department
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND employee.uid = employee_uid::text
  )
);

-- ============================================
-- SUPER ADMINS: View all leave requests
-- ============================================

CREATE POLICY "Super admins can view all leave requests"
ON leave_requests
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
-- MANAGERS & ADMINS: Update leave requests
-- ============================================

CREATE POLICY "Managers and admins can update leave requests"
ON leave_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND (
        role = 'super_admin'
        OR username = leave_requests.assigned_to
      )
  )
);

-- ============================================
-- MANAGERS: Update department leave requests
-- ============================================

CREATE POLICY "Managers can update department leave requests"
ON leave_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee
      ON employee.department = manager.department
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND employee.uid = employee_uid::text
  )
);

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_leave_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_leave_requests_updated_at
BEFORE UPDATE ON leave_requests
FOR EACH ROW
EXECUTE FUNCTION update_leave_requests_updated_at();
