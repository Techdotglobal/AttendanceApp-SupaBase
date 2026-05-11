-- ============================================
-- Multi-tenant: users.company_id
-- ============================================
-- Links each profile row to a single company. JWT user_metadata.company_id
-- is synced from this column (never trusted from the client alone for writes).
-- ============================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- Backfill existing rows to the first company (single-tenant → SaaS migration).
UPDATE users
SET company_id = (
  SELECT id FROM companies ORDER BY created_at ASC NULLS LAST LIMIT 1
)
WHERE company_id IS NULL;

COMMENT ON COLUMN users.company_id IS 'Tenant scope; synced into Supabase Auth user_metadata for JWT / RLS.';
