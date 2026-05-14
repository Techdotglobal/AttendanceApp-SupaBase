-- ============================================
-- Notifications Table Migration (Supabase)
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Table
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  recipient_uid UUID NOT NULL,              -- auth.uid() of the notification recipient
  recipient_username VARCHAR(255),           -- Username (display only, for convenience)

  title TEXT NOT NULL,                       -- Notification title
  body TEXT NOT NULL,                        -- Notification message/body
  type VARCHAR(50) DEFAULT 'general',        -- Notification type (ticket_created, leave_request, leave_approved, leave_rejected, ticket_assigned, ticket_response, system, general)
  
  data JSONB DEFAULT '{}'::jsonb,           -- Additional data (navigation payload, metadata, etc.)
  
  read BOOLEAN DEFAULT false,                -- Read status
  read_at TIMESTAMPTZ,                       -- Timestamp when marked as read

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_uid
ON notifications(recipient_uid);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_username
ON notifications(recipient_username);

CREATE INDEX IF NOT EXISTS idx_notifications_read
ON notifications(read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
ON notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type
ON notifications(type);

-- Composite index for common queries (unread notifications for a user)
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
ON notifications(recipient_uid, read)
WHERE read = false;

-- ============================================
-- Enable RLS
-- ============================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS: View own notifications
-- ============================================

CREATE POLICY "Users can view own notifications"
ON notifications
FOR SELECT
USING (
  recipient_uid = auth.uid()
);

-- ============================================
-- USERS: Update own notifications (mark as read)
-- ============================================

CREATE POLICY "Users can update own notifications"
ON notifications
FOR UPDATE
USING (
  recipient_uid = auth.uid()
)
WITH CHECK (
  recipient_uid = auth.uid()
);

-- ============================================
-- SYSTEM: Insert notifications (via service role or function)
-- ============================================

-- Note: INSERT policy should be handled via service role or database functions
-- Regular users should not insert notifications directly
-- This policy allows service role to insert (RLS bypassed for service role)
-- For application-level inserts, use a database function with SECURITY DEFINER

-- Allow service role inserts (service role bypasses RLS)
-- Regular authenticated users cannot insert directly for security

-- ============================================
-- Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  -- If read status changed to true, set read_at timestamp
  IF NEW.read = true AND (OLD.read IS NULL OR OLD.read = false) THEN
    NEW.read_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_notifications_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW
EXECUTE FUNCTION update_notifications_updated_at();

-- ============================================
-- Enable Realtime
-- ============================================

-- Enable Realtime for notifications table
-- This allows clients to subscribe to INSERT/UPDATE events
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ============================================
-- Helper Function: Create Notification
-- ============================================

-- Function to create notifications securely
-- Can be called from backend services or database triggers
CREATE OR REPLACE FUNCTION create_notification(
  p_recipient_uid UUID,
  p_recipient_username VARCHAR(255),
  p_title TEXT,
  p_body TEXT,
  p_type VARCHAR(50) DEFAULT 'general',
  p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (
    recipient_uid,
    recipient_username,
    title,
    body,
    type,
    data
  ) VALUES (
    p_recipient_uid,
    p_recipient_username,
    p_title,
    p_body,
    p_type,
    p_data
  )
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$;

-- Grant execute permission to authenticated users (if needed)
-- GRANT EXECUTE ON FUNCTION create_notification TO authenticated;

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE notifications IS 'Stores user notifications for real-time delivery';
COMMENT ON COLUMN notifications.recipient_uid IS 'Supabase Auth UID of the notification recipient';
COMMENT ON COLUMN notifications.recipient_username IS 'Username for display and filtering convenience';
COMMENT ON COLUMN notifications.type IS 'Notification type: ticket_created, leave_request, leave_approved, leave_rejected, ticket_assigned, ticket_response, system, general';
COMMENT ON COLUMN notifications.data IS 'Additional JSON data including navigation payload and metadata';
COMMENT ON COLUMN notifications.read IS 'Whether the notification has been read by the recipient';
COMMENT ON FUNCTION create_notification IS 'Securely creates a notification. Can be called from backend services or database triggers.';
