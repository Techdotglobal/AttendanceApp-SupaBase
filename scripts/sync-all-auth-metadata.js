/**
 * Refresh Supabase Auth user_metadata (company_id, role, department_id) from
 * public.users for every profile. Run once after DB maintenance that changes
 * company_id (e.g. merge_duplicate_companies migration).
 *
 * Usage (from repo root):
 *   node scripts/sync-all-auth-metadata.js
 *
 * Loads env from services/auth-service/.env (override with DOTENV_CONFIG_PATH).
 */
const path = require('path');
const fs = require('fs');

const envPath =
  process.env.DOTENV_CONFIG_PATH ||
  path.join(__dirname, '..', 'services', 'auth-service', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');
const { syncAuthMetadataForUid } = require('../services/auth-service/lib/authMetadata');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (check auth-service .env)');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await supabase.from('users').select('uid').order('username');
  if (error) {
    console.error('Failed to list users:', error.message);
    process.exit(1);
  }

  const uids = (rows || []).map((r) => r.uid).filter(Boolean);
  console.log(`Syncing Auth metadata for ${uids.length} users…`);

  let ok = 0;
  let fail = 0;
  for (const uid of uids) {
    const res = await syncAuthMetadataForUid(supabase, uid);
    if (res.ok) {
      ok += 1;
    } else {
      fail += 1;
      console.warn(`  ${uid}: ${res.error}`);
    }
  }

  console.log(`Done. OK=${ok} failed=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
