-- ============================================
-- Multi-tenant: users.company_id
-- ============================================
-- Links each profile row to a single company. JWT user_metadata.company_id
-- is synced from this column (never trusted from the client alone for writes).
--
-- IMPORTANT (multi-tenant):
--   The UPDATE below is a ONE-TIME backfill for pre-existing rows from the
--   single-tenant era. It picks the oldest companies row solely to preserve
--   legacy data; new tenants must NEVER inherit company_id this way. All
--   new users are created by the auth-service (/api/auth/onboard-company
--   or /api/auth/users) with an explicit, validated company_id.
-- ============================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- One-time legacy backfill (single-tenant → SaaS migration). Safe to run
-- once; on a fresh multi-tenant install there are no rows to backfill, so
-- this is a no-op.
UPDATE users
SET company_id = (
  SELECT id FROM companies ORDER BY created_at ASC NULLS LAST LIMIT 1
)
WHERE company_id IS NULL;

COMMENT ON COLUMN users.company_id IS 'Tenant scope; synced into Supabase Auth user_metadata for JWT / RLS. Must be set explicitly by auth-service on insert (no default fallback).';
