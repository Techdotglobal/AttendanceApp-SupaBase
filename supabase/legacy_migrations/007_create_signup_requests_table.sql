-- ============================================
-- Signup Requests Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS signup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  username VARCHAR(255) NOT NULL UNIQUE,
  password TEXT NOT NULL,                    -- Encrypted/hashed password (temporary, removed after approval)
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'employee',         -- 'employee', 'manager', etc.

  status VARCHAR(50) DEFAULT 'pending',     -- 'pending', 'approved', 'rejected'
  
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by VARCHAR(255),                   -- Username of admin who approved/rejected
  rejection_reason TEXT,                      -- Reason for rejection (if rejected)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_signup_requests_status
ON signup_requests(status);

CREATE INDEX IF NOT EXISTS idx_signup_requests_username
ON signup_requests(username);

CREATE INDEX IF NOT EXISTS idx_signup_requests_requested_at
ON signup_requests(requested_at DESC);

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE signup_requests ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS: View own signup requests
-- ============================================

CREATE POLICY "Users can view own signup requests"
ON signup_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND username = signup_requests.username
  )
);

-- ============================================
-- ANYONE: Create signup requests (for new users)
-- ============================================

CREATE POLICY "Anyone can create signup requests"
ON signup_requests
FOR INSERT
WITH CHECK (true);

-- ============================================
-- SUPER ADMINS: View all signup requests
-- ============================================

CREATE POLICY "Super admins can view all signup requests"
ON signup_requests
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
-- SUPER ADMINS: Update signup requests (approve/reject)
-- ============================================

CREATE POLICY "Super admins can update signup requests"
ON signup_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND role = 'super_admin'
  )
);

-- ============================================
-- SUPER ADMINS: Delete signup requests
-- ============================================

CREATE POLICY "Super admins can delete signup requests"
ON signup_requests
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE uid = auth.uid()::text
      AND role = 'super_admin'
  )
);

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_signup_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_signup_requests_updated_at
BEFORE UPDATE ON signup_requests
FOR EACH ROW
EXECUTE FUNCTION update_signup_requests_updated_at();

