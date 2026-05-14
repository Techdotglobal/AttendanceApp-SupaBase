-- ============================================
-- Office Location Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS office_location (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  latitude DOUBLE PRECISION NOT NULL,          -- Office latitude (-90 to 90)
  longitude DOUBLE PRECISION NOT NULL,         -- Office longitude (-180 to 180)
  radius_meters INTEGER NOT NULL DEFAULT 1000, -- Geofence radius in meters (default: 1000m = 1km)

  updated_by VARCHAR(255),                      -- Username of user who last updated (server-set only)
  updated_at TIMESTAMPTZ DEFAULT NOW(),         -- Timestamp of last update
  
  singleton INTEGER DEFAULT 1 NOT NULL          -- Constant column for single-row enforcement
);

-- ============================================
-- Constraints
-- ============================================

-- Ensure latitude is within valid range
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_latitude_range' 
    AND conrelid = 'office_location'::regclass
  ) THEN
    ALTER TABLE office_location
    ADD CONSTRAINT check_latitude_range
    CHECK (latitude >= -90 AND latitude <= 90);
  END IF;
END $$;

-- Ensure longitude is within valid range
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_longitude_range' 
    AND conrelid = 'office_location'::regclass
  ) THEN
    ALTER TABLE office_location
    ADD CONSTRAINT check_longitude_range
    CHECK (longitude >= -180 AND longitude <= 180);
  END IF;
END $$;

-- Ensure radius is positive
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'check_radius_positive' 
    AND conrelid = 'office_location'::regclass
  ) THEN
    ALTER TABLE office_location
    ADD CONSTRAINT check_radius_positive
    CHECK (radius_meters > 0);
  END IF;
END $$;

-- ============================================
-- Indexes
-- ============================================

-- Unique index on singleton to enforce single row (safe, no race conditions)
-- This is the ONLY method used for singleton enforcement
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_location_singleton
ON office_location((1));

-- Index on updated_at for querying latest location
CREATE INDEX IF NOT EXISTS idx_office_location_updated_at
ON office_location(updated_at DESC);

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE office_location ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies
-- ============================================

-- All authenticated users can view the office location
DROP POLICY IF EXISTS "Users can view office location" ON office_location;
CREATE POLICY "Users can view office location"
ON office_location
FOR SELECT
TO authenticated
USING (true);

-- Only super_admin and HR (manager with department='HR') can update office location
-- Regular managers (non-HR) are NOT allowed
DROP POLICY IF EXISTS "Super admins and HR can update office location" ON office_location;
CREATE POLICY "Super admins and HR can update office location"
ON office_location
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND (
        users.role = 'super_admin'
        OR (users.role = 'manager' AND users.department = 'HR')
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid::text = auth.uid()::text
      AND (
        users.role = 'super_admin'
        OR (users.role = 'manager' AND users.department = 'HR')
      )
  )
);

-- Only super_admin can insert office location (initial setup)
DROP POLICY IF EXISTS "Super admins can insert office location" ON office_location;
CREATE POLICY "Super admins can insert office location"
ON office_location
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

-- DELETE is completely disabled - no policy means no one can delete
-- This ensures the office location cannot be accidentally removed

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_office_location_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_office_location_updated_at ON office_location;
CREATE TRIGGER trigger_update_office_location_updated_at
BEFORE UPDATE ON office_location
FOR EACH ROW
EXECUTE FUNCTION update_office_location_updated_at();

-- ============================================
-- Helper Functions
-- ============================================

/**
 * Get the current office location
 * Returns the single office location record (or empty if not set)
 * Safe for all authenticated users
 */
CREATE OR REPLACE FUNCTION get_office_location()
RETURNS TABLE (
  id UUID,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  radius_meters INTEGER,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ol.id,
    ol.latitude,
    ol.longitude,
    ol.radius_meters,
    ol.updated_by,
    ol.updated_at
  FROM office_location ol
  LIMIT 1;
END;
$$;

/**
 * Set or update office location
 * Uses UPSERT (INSERT ... ON CONFLICT) for safe singleton updates
 * Only super_admin and HR can use this function
 * updated_by is ALWAYS set server-side from auth.uid() lookup
 */
CREATE OR REPLACE FUNCTION set_office_location(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 1000
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id UUID;
  v_user_username VARCHAR(255);
  v_user_role VARCHAR(50);
  v_user_department VARCHAR(255);
  v_is_authorized BOOLEAN := false;
BEGIN
  -- SECURITY: Get current user info and verify authorization
  -- This is done server-side, not relying on client input
  -- Cast both sides to text to handle type compatibility (uid may be UUID or TEXT)
  SELECT 
    username,
    role,
    department
  INTO 
    v_user_username,
    v_user_role,
    v_user_department
  FROM users
  WHERE uid::text = auth.uid()::text
  LIMIT 1;

  -- Check if user exists
  IF v_user_username IS NULL THEN
    -- Try fallback: check if auth.uid() exists at all
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required. Please log in.';
    ELSE
      RAISE EXCEPTION 'User not found. Your account may not be properly set up in the database.';
    END IF;
  END IF;

  -- SECURITY: Internal role check (do not rely on RLS alone)
  -- Only super_admin or HR (manager with department='HR') can update
  IF v_user_role = 'super_admin' THEN
    v_is_authorized := true;
  ELSIF v_user_role = 'manager' AND v_user_department = 'HR' THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Insufficient permissions. Only super_admin and HR can update office location.';
  END IF;

  -- Validate inputs
  IF p_latitude < -90 OR p_latitude > 90 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90';
  END IF;

  IF p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180';
  END IF;

  IF p_radius_meters <= 0 THEN
    RAISE EXCEPTION 'Radius must be greater than 0';
  END IF;

  -- UPSERT: Use INSERT ... ON CONFLICT for safe singleton update
  -- The unique index on singleton ensures only one row exists
  INSERT INTO office_location (
    latitude,
    longitude,
    radius_meters,
    updated_by,
    singleton
  ) VALUES (
    p_latitude,
    p_longitude,
    p_radius_meters,
    v_user_username,  -- Server-set from auth.uid() lookup
    1
  )
  ON CONFLICT ((1))  -- Conflict on singleton unique index
  DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    radius_meters = EXCLUDED.radius_meters,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_office_location() TO authenticated;
GRANT EXECUTE ON FUNCTION set_office_location(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE office_location IS 'Stores the single office location for geofencing. Only one row can exist (enforced by unique index on singleton).';
COMMENT ON COLUMN office_location.latitude IS 'Office latitude coordinate (-90 to 90)';
COMMENT ON COLUMN office_location.longitude IS 'Office longitude coordinate (-180 to 180)';
COMMENT ON COLUMN office_location.radius_meters IS 'Geofence radius in meters. Default: 1000m (1km)';
COMMENT ON COLUMN office_location.updated_by IS 'Username of the user who last updated the location (server-set only, derived from auth.uid())';
COMMENT ON COLUMN office_location.updated_at IS 'Timestamp when the location was last updated (auto-updated via trigger)';
COMMENT ON COLUMN office_location.singleton IS 'Constant column (always 1) used with unique index to enforce single-row table';
COMMENT ON FUNCTION get_office_location() IS 'Returns the current office location. Safe for all authenticated users. Returns empty if no location is set.';
COMMENT ON FUNCTION set_office_location(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) IS 'Sets or updates the office location using UPSERT. Only super_admin and HR can use this. updated_by is always set server-side from auth.uid() lookup.';
