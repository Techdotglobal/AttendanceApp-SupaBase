-- ============================================
-- Attendance Records Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_uid UUID NOT NULL,                    -- auth.uid() of the user
  username VARCHAR(255) NOT NULL,            -- Username (display only)
  employee_name VARCHAR(255),                -- Employee name (display only)

  type VARCHAR(50) NOT NULL,                  -- 'checkin' or 'checkout'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  location JSONB,                             -- Location data { address, latitude, longitude }
  photo TEXT,                                 -- Photo URI (if available)
  auth_method VARCHAR(50),                    -- 'biometric', 'face', 'manual', etc.

  is_manual BOOLEAN DEFAULT false,             -- Whether created manually by admin/manager
  created_by VARCHAR(255),                    -- Username of admin/manager who created (if manual)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(255)                     -- Username who updated (if applicable)
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_attendance_records_user_uid
ON attendance_records(user_uid);

CREATE INDEX IF NOT EXISTS idx_attendance_records_username
ON attendance_records(username);

CREATE INDEX IF NOT EXISTS idx_attendance_records_timestamp
ON attendance_records(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_type
ON attendance_records(type);

-- Note: Date-based queries can use idx_attendance_records_timestamp efficiently
-- No separate date index needed to avoid IMMUTABLE function issues

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS: View own attendance records
-- ============================================

CREATE POLICY "Users can view own attendance records"
ON attendance_records
FOR SELECT
USING (
  user_uid = auth.uid()
);

-- ============================================
-- USERS: Create own attendance records
-- ============================================

CREATE POLICY "Users can create own attendance records"
ON attendance_records
FOR INSERT
WITH CHECK (
  user_uid = auth.uid()
);

-- ============================================
-- USERS: Update own attendance records
-- ============================================

CREATE POLICY "Users can update own attendance records"
ON attendance_records
FOR UPDATE
USING (
  user_uid = auth.uid()
);

-- ============================================
-- MANAGERS: View department attendance records
-- ============================================

CREATE POLICY "Managers can view department attendance records"
ON attendance_records
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND EXISTS (
        SELECT 1
        FROM users employee
        WHERE employee.uid = attendance_records.user_uid::text
          AND employee.department = manager.department
      )
  )
);

-- ============================================
-- SUPER ADMINS: View all attendance records
-- ============================================

CREATE POLICY "Super admins can view all attendance records"
ON attendance_records
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
-- MANAGERS & ADMINS: Create manual attendance records
-- ============================================

CREATE POLICY "Managers and admins can create manual attendance records"
ON attendance_records
FOR INSERT
WITH CHECK (
  is_manual = true
  AND EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND role IN ('manager', 'super_admin')
  )
);

-- ============================================
-- MANAGERS & ADMINS: Update attendance records
-- ============================================

CREATE POLICY "Managers and admins can update attendance records"
ON attendance_records
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND (
        role = 'super_admin'
        OR (
          role = 'manager'
          AND EXISTS (
            SELECT 1
            FROM users employee
            WHERE employee.uid = attendance_records.user_uid::text
              AND employee.department = users.department
          )
        )
      )
  )
);

-- ============================================
-- MANAGERS & ADMINS: Delete attendance records
-- ============================================

CREATE POLICY "Managers and admins can delete attendance records"
ON attendance_records
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND (
        role = 'super_admin'
        OR (
          role = 'manager'
          AND EXISTS (
            SELECT 1
            FROM users employee
            WHERE employee.uid = attendance_records.user_uid::text
              AND employee.department = users.department
          )
        )
      )
  )
);

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_attendance_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_attendance_records_updated_at
BEFORE UPDATE ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION update_attendance_records_updated_at();

