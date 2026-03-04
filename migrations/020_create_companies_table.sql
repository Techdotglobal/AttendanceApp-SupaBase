-- ============================================
-- Companies Table & RLS (Company Logo Customization)
-- ============================================
-- Migration: 020
-- Description: Creates companies table for single-company logo customization.
-- Run this script in Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. Create companies table
-- ============================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. Insert default company record (only if table is empty)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies LIMIT 1) THEN
    INSERT INTO companies (name) VALUES ('Default Company');
  END IF;
END $$;

-- ============================================
-- 3. updated_at trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

-- ============================================
-- 4. Enable Row Level Security (RLS)
-- ============================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. RLS Policies
-- ============================================
-- Assumes: public.users table with (uid UUID, role TEXT)
-- uid links to auth.uid()

-- Policy: Authenticated users can SELECT (read) company
DROP POLICY IF EXISTS "Authenticated users can read company" ON companies;
CREATE POLICY "Authenticated users can read company"
ON companies
FOR SELECT
TO authenticated
USING (true);

-- Policy: Only super_admin can UPDATE company
DROP POLICY IF EXISTS "Only super_admin can update company" ON companies;
CREATE POLICY "Only super_admin can update company"
ON companies
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE (users.uid::text = auth.uid()::text)
    AND users.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE (users.uid::text = auth.uid()::text)
    AND users.role = 'super_admin'
  )
);

-- Optional: Only super_admin can INSERT (if you add more companies later)
-- CREATE POLICY "Only super_admin can insert company"
-- ON companies FOR INSERT TO authenticated
-- WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.uid = auth.uid() AND users.role = 'super_admin'));

-- Optional: Deny DELETE to keep single company (or allow super_admin to delete)
-- By default, no DELETE policy = no one can delete.

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE companies IS 'Single company record for app branding (e.g. logo). One row expected.';
COMMENT ON COLUMN companies.logo_url IS 'Public URL of logo image stored in storage bucket company-logos';
