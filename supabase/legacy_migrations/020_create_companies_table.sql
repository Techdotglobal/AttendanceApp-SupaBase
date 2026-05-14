-- ============================================
-- Companies Table & RLS (multi-tenant root)
-- ============================================
-- Migration: 020
-- Description: Creates companies table.
-- Run this script in Supabase SQL Editor.
--
-- IMPORTANT (multi-tenant):
--   No default/seed row is inserted here. Every tenant MUST be created
--   through POST /api/auth/onboard-company so a brand-new company row is
--   inserted alongside its Management department and super_admin.
--   See migration 026 if you previously ran an older version of this file
--   that seeded a "Default Company" row.
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
-- 2. (Removed) Default company seed
-- ============================================
-- Intentionally left blank: tenant rows must be inserted by the onboarding
-- flow (auth-service /api/auth/onboard-company) so each tenant is fully
-- isolated. There is no implicit/global "default" company.

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

COMMENT ON TABLE companies IS 'Tenant root. One row per tenant; created by /api/auth/onboard-company. No implicit/default row.';
COMMENT ON COLUMN companies.logo_url IS 'Public URL of logo image stored in storage bucket company-logos';
