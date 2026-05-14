-- ============================================
-- Ensure Office Location RLS Policies
-- ============================================
-- This migration ensures RLS policies are correctly set:
-- - Everyone (all authenticated users) can read office_location
-- - Only super_admin and HR can update office_location

-- ============================================
-- Drop existing policies if they exist (for idempotency)
-- ============================================

DROP POLICY IF EXISTS "Users can view office location" ON office_location;
DROP POLICY IF EXISTS "Super admins and HR can update office location" ON office_location;

-- ============================================
-- RLS Policies
-- ============================================

-- Policy 1: All authenticated users can SELECT (read) office location
CREATE POLICY "Users can view office location"
ON office_location
FOR SELECT
TO authenticated
USING (true);

-- Policy 2: Only super_admin and HR (manager with department='HR') can UPDATE office location
-- Regular managers (non-HR) are NOT allowed to update
CREATE POLICY "Super admins and HR can update office location"
ON office_location
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.uid = auth.uid()::text
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
    WHERE users.uid = auth.uid()::text
      AND (
        users.role = 'super_admin'
        OR (users.role = 'manager' AND users.department = 'HR')
      )
  )
);

-- ============================================
-- Verify RLS is enabled
-- ============================================

ALTER TABLE office_location ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Comments
-- ============================================

COMMENT ON POLICY "Users can view office location" ON office_location IS 
'Allows all authenticated users to read the office location. This is needed for geofencing validation during check-in.';

COMMENT ON POLICY "Super admins and HR can update office location" ON office_location IS 
'Restricts UPDATE operations to super_admin and HR managers only. Regular managers cannot update the office location.';
