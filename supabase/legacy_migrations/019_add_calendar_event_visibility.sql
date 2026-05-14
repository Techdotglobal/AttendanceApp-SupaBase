-- ============================================
-- Add Visibility Control to Calendar Events
-- ============================================
-- Migration: 019
-- Description: Adds visibility field and updates visibleTo logic for calendar events

-- ============================================
-- Add new columns
-- ============================================

-- Add visibility column (all, none, selected)
ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'all' CHECK (visibility IN ('all', 'none', 'selected'));

-- Rename assigned_to to visible_to for clarity (keep both for backward compatibility)
-- We'll use visible_to as the primary field going forward
ALTER TABLE calendar_events
ADD COLUMN IF NOT EXISTS visible_to JSONB DEFAULT '[]'::jsonb;

-- Note: created_by_uid should already exist, but we don't force NOT NULL
-- to maintain backward compatibility with existing data

-- ============================================
-- Migrate existing data
-- ============================================

-- Set visibility based on assigned_to:
-- - Empty array = 'all'
-- - Non-empty array = 'selected'
-- - We'll set 'none' manually for events that should be private
UPDATE calendar_events
SET visibility = CASE
  WHEN assigned_to = '[]'::jsonb OR assigned_to IS NULL THEN 'all'
  ELSE 'selected'
END;

-- Copy assigned_to to visible_to for backward compatibility
UPDATE calendar_events
SET visible_to = COALESCE(assigned_to, '[]'::jsonb);

-- For 'none' visibility, set visible_to to contain only the creator
UPDATE calendar_events
SET visible_to = jsonb_build_array(created_by)
WHERE visibility = 'none';

-- ============================================
-- Update RLS Policies
-- ============================================

-- Drop old policy
DROP POLICY IF EXISTS "Users can view calendar events" ON calendar_events;

-- Create new policy with visibility logic
CREATE POLICY "Users can view calendar events"
ON calendar_events
FOR SELECT
USING (
  -- User is creator (always can see their own events)
  created_by_uid = auth.uid()
  OR
  -- Visibility is 'all' (public event)
  visibility = 'all'
  OR
  -- Visibility is 'selected' and user is in visible_to array
  (
    visibility = 'selected'
    AND visible_to IS NOT NULL
    AND (
      visible_to::text LIKE '%' || (SELECT username FROM users WHERE uid = auth.uid()::text LIMIT 1) || '%'
      OR visible_to::text LIKE '%' || auth.uid()::text || '%'
    )
  )
);

-- ============================================
-- Indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_calendar_events_visibility
ON calendar_events(visibility);

CREATE INDEX IF NOT EXISTS idx_calendar_events_visible_to
ON calendar_events USING GIN(visible_to);

-- ============================================
-- Comments
-- ============================================

COMMENT ON COLUMN calendar_events.visibility IS 'Event visibility: all (visible to all), none (only creator), selected (only selected users)';
COMMENT ON COLUMN calendar_events.visible_to IS 'Array of usernames/UIDs who can see the event (only used when visibility = selected)';
COMMENT ON COLUMN calendar_events.assigned_to IS 'Legacy field - kept for backward compatibility. Use visible_to instead.';
