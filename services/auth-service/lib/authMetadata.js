/**
 * Multi-tenant JWT user_metadata (Supabase Auth).
 *
 * Tenant fields (company_id, role, department) are written only from trusted
 * server code using the service role, after reading public.users — not from
 * arbitrary client payloads — so RLS can safely align claims with the database.
 */

/**
 * @param {object} row - users table row (snake_case from PostgREST)
 * @returns {Record<string, string | null>}
 */
function buildUserMetadataFromUserRow(row) {
  if (!row) return {};
  return {
    username: row.username != null ? String(row.username) : null,
    name: row.name != null ? String(row.name) : row.username != null ? String(row.username) : null,
    company_id: row.company_id != null ? String(row.company_id) : null,
    role: row.role != null ? String(row.role) : null,
    department: row.department != null ? String(row.department) : null,
  };
}

/**
 * Merge tenant metadata into existing user_metadata (preserves unrelated keys).
 * @param {Record<string, unknown>|null|undefined} existing
 * @param {object} row
 * @returns {Record<string, unknown>}
 */
function mergeTenantUserMetadata(existing, row) {
  const tenant = buildUserMetadataFromUserRow(row);
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  return { ...base, ...tenant };
}

/**
 * @param {Record<string, unknown>|null|undefined} meta
 * @param {object} row - users row
 * @returns {boolean}
 */
function tenantMetadataMatchesRow(meta, row) {
  if (!row) return false;
  const expected = buildUserMetadataFromUserRow(row);
  const pairs = [
    ['company_id', 'company_id'],
    ['role', 'role'],
    ['department', 'department'],
  ];
  for (const [metaKey, rowKey] of pairs) {
    const a = meta?.[metaKey] != null ? String(meta[metaKey]).trim() : '';
    const b = row[rowKey] != null ? String(row[rowKey]).trim() : '';
    if (a !== b) return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>|null|undefined} meta
 * @returns {boolean}
 */
function isTenantMetadataComplete(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.company_id == null || String(meta.company_id).trim() === '') return false;
  if (meta.role == null || String(meta.role).trim() === '') return false;
  return true;
}

/**
 * Refresh Supabase Auth user_metadata from public.users (service role only).
 * @param {*} supabaseAdmin - Supabase client with service role
 * @param {string} uid
 * @returns {Promise<{ ok: true, row: object } | { ok: false, error: string }>}
 */
async function syncAuthMetadataForUid(supabaseAdmin, uid) {
  if (!uid) {
    return { ok: false, error: 'uid required' };
  }
  const { data: row, error: rowError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();

  if (rowError) {
    return { ok: false, error: rowError.message || 'Failed to load user profile' };
  }
  if (!row) {
    return { ok: false, error: 'User profile not found' };
  }

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(uid);
  if (authErr || !authData?.user) {
    return { ok: false, error: authErr?.message || 'Auth user not found' };
  }

  const merged = mergeTenantUserMetadata(authData.user.user_metadata, row);
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(uid, {
    user_metadata: merged,
  });
  if (updErr) {
    return { ok: false, error: updErr.message || 'Failed to update auth metadata' };
  }
  return { ok: true, row };
}

module.exports = {
  buildUserMetadataFromUserRow,
  mergeTenantUserMetadata,
  tenantMetadataMatchesRow,
  isTenantMetadataComplete,
  syncAuthMetadataForUid,
};
