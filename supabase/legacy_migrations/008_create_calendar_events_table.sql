-- ============================================
-- Calendar Events Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  title VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  time TIME,                                  -- Optional time (HH:MM:SS)
  type VARCHAR(50) DEFAULT 'other',          -- 'meeting', 'reminder', 'holiday', 'other'
  color VARCHAR(7) DEFAULT '#3b82f6',         -- Hex color code

  created_by_uid UUID,                        -- auth.uid() of creator (optional, for user-created events)
  created_by VARCHAR(255),                    -- Username of creator (display only)

  assigned_to JSONB DEFAULT '[]'::jsonb,      -- Array of usernames/UIDs (empty = visible to all)
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_calendar_events_date
ON calendar_events(date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_type
ON calendar_events(type);

CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by_uid
ON calendar_events(created_by_uid);

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS: View all calendar events (public events)
-- ============================================

CREATE POLICY "Users can view calendar events"
ON calendar_events
FOR SELECT
USING (
  -- Event is public (assigned_to is empty array)
  assigned_to = '[]'::jsonb
  -- OR user is in assigned_to array
  OR (
    assigned_to IS NOT NULL
    AND (
      assigned_to::text LIKE '%' || (SELECT username FROM users WHERE uid = auth.uid()::text LIMIT 1) || '%'
      OR assigned_to::text LIKE '%' || auth.uid()::text || '%'
    )
  )
  -- OR user created the event
  OR created_by_uid = auth.uid()
);

-- ============================================
-- USERS: Create calendar events
-- ============================================

CREATE POLICY "Users can create calendar events"
ON calendar_events
FOR INSERT
WITH CHECK (
  created_by_uid = auth.uid()
  OR created_by_uid IS NULL  -- Allow system/admin created events
);

-- ============================================
-- USERS: Update own calendar events
-- ============================================

CREATE POLICY "Users can update own calendar events"
ON calendar_events
FOR UPDATE
USING (
  created_by_uid = auth.uid()
);

-- ============================================
-- SUPER ADMINS: View all calendar events
-- ============================================

CREATE POLICY "Super admins can view all calendar events"
ON calendar_events
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
-- SUPER ADMINS: Update all calendar events
-- ============================================

CREATE POLICY "Super admins can update all calendar events"
ON calendar_events
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
-- SUPER ADMINS: Delete calendar events
-- ============================================

CREATE POLICY "Super admins can delete calendar events"
ON calendar_events
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

CREATE OR REPLACE FUNCTION update_calendar_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_calendar_events_updated_at
BEFORE UPDATE ON calendar_events
FOR EACH ROW
EXECUTE FUNCTION update_calendar_events_updated_at();

