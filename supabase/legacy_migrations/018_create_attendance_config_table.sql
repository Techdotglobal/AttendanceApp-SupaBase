-- ============================================
-- Attendance Configuration Table Migration
-- ============================================
-- Stores global attendance settings like auto_checkout_enabled
-- Only super_admin can modify these settings

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS attendance_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  config_key VARCHAR(255) UNIQUE NOT NULL,  -- e.g., 'auto_checkout_enabled'
  config_value JSONB NOT NULL,              -- e.g., {"enabled": true}
  description TEXT,                          -- Human-readable description
  
  updated_by VARCHAR(255),                   -- Username of super_admin who last updated
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  singleton INTEGER DEFAULT 1 NOT NULL       -- Constant for single-row enforcement
);

-- ============================================
-- Constraints
-- ============================================

-- Ensure singleton (only one config row)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_config_singleton
ON attendance_config((1));

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_attendance_config_key
ON attendance_config(config_key);

CREATE INDEX IF NOT EXISTS idx_attendance_config_updated_at
ON attendance_config(updated_at DESC);

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE attendance_config ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies
-- ============================================

-- All authenticated users can read config (needed for app logic)
DROP POLICY IF EXISTS "Users can view attendance config" ON attendance_config;
CREATE POLICY "Users can view attendance config"
ON attendance_config
FOR SELECT
TO authenticated
USING (true);

-- Only super_admin can update config
DROP POLICY IF EXISTS "Super admins can update attendance config" ON attendance_config;
CREATE POLICY "Super admins can update attendance config"
ON attendance_config
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND users.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND users.role = 'super_admin'
  )
);

-- Only super_admin can insert config
DROP POLICY IF EXISTS "Super admins can insert attendance config" ON attendance_config;
CREATE POLICY "Super admins can insert attendance config"
ON attendance_config
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND users.role = 'super_admin'
  )
);

-- DELETE is disabled - no policy means no one can delete

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_attendance_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_attendance_config_updated_at ON attendance_config;
CREATE TRIGGER trigger_update_attendance_config_updated_at
BEFORE UPDATE ON attendance_config
FOR EACH ROW
EXECUTE FUNCTION update_attendance_config_updated_at();

-- ============================================
-- Helper Functions
-- ============================================

/**
 * Get attendance configuration value
 * Returns the config value for a given key, or default if not found
 */
CREATE OR REPLACE FUNCTION get_attendance_config(p_config_key VARCHAR(255))
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_value JSONB;
BEGIN
  SELECT config_value
  INTO v_config_value
  FROM attendance_config
  WHERE config_key = p_config_key
  LIMIT 1;
  
  RETURN COALESCE(v_config_value, '{}'::jsonb);
END;
$$;

/**
 * Set attendance configuration value
 * Only super_admin can use this function
 */
CREATE OR REPLACE FUNCTION set_attendance_config(
  p_config_key VARCHAR(255),
  p_config_value JSONB,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_id UUID;
  v_user_username VARCHAR(255);
  v_user_role VARCHAR(50);
BEGIN
  -- SECURITY: Get current user info and verify authorization
  SELECT 
    username,
    role
  INTO 
    v_user_username,
    v_user_role
  FROM users
  WHERE uid::text = auth.uid()::text
  LIMIT 1;

  -- Check if user exists
  IF v_user_username IS NULL THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required. Please log in.';
    ELSE
      RAISE EXCEPTION 'User not found. Your account may not be properly set up in the database.';
    END IF;
  END IF;

  -- SECURITY: Only super_admin can update config
  IF v_user_role != 'super_admin' THEN
    RAISE EXCEPTION 'Insufficient permissions. Only super_admin can update attendance configuration.';
  END IF;

  -- UPSERT: Insert or update config
  INSERT INTO attendance_config (
    config_key,
    config_value,
    description,
    updated_by,
    singleton
  ) VALUES (
    p_config_key,
    p_config_value,
    p_description,
    v_user_username,
    1
  )
  ON CONFLICT (config_key)
  DO UPDATE SET
    config_value = EXCLUDED.config_value,
    description = COALESCE(EXCLUDED.description, attendance_config.description),
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
  RETURNING id INTO v_config_id;

  RETURN v_config_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_attendance_config(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION set_attendance_config(VARCHAR, JSONB, TEXT) TO authenticated;

-- ============================================
-- Initialize Default Config
-- ============================================
-- Insert default auto_checkout_enabled = false
-- This will only insert if the key doesn't exist (safe to run multiple times)

INSERT INTO attendance_config (config_key, config_value, description, updated_by, singleton)
VALUES (
  'auto_checkout_enabled',
  '{"enabled": false}'::jsonb,
  'Enable automatic checkout when employee leaves 1km office radius',
  'system',
  1
)
ON CONFLICT (config_key) DO NOTHING;

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE attendance_config IS 'Stores global attendance configuration settings. Only super_admin can modify.';
COMMENT ON COLUMN attendance_config.config_key IS 'Unique configuration key (e.g., auto_checkout_enabled)';
COMMENT ON COLUMN attendance_config.config_value IS 'JSONB value for the configuration (e.g., {"enabled": true})';
COMMENT ON FUNCTION get_attendance_config(VARCHAR) IS 'Get configuration value by key. Safe for all authenticated users.';
COMMENT ON FUNCTION set_attendance_config(VARCHAR, JSONB, TEXT) IS 'Set configuration value. Only super_admin can use this.';
