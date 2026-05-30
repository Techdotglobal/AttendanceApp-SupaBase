const { normalizedUsernameKey, usernameEqVariants } = require('./loginNormalize');

/**
 * Find a tenant user by login identifier (normalized key + exact username variants).
 * @param {*} supabase
 * @param {string} companyId
 * @param {string} username
 * @param {(import('@supabase/supabase-js').PostgrestFilterBuilder)=>import('@supabase/supabase-js').PostgrestFilterBuilder} [applyScope]
 */
async function findUserByUsernameInCompany(supabase, companyId, username, applyScope) {
  const select =
    'uid, username, email, role, department, company_id, normalized_username';
  const base = () => {
    let q = supabase.from('users').select(select).eq('company_id', companyId);
    if (typeof applyScope === 'function') {
      q = applyScope(q);
    }
    return q;
  };

  const key = normalizedUsernameKey(username);
  if (key) {
    const { data, error } = await base().eq('normalized_username', key).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  for (const variant of usernameEqVariants(username)) {
    const { data, error } = await base().eq('username', variant).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

/**
 * @returns {Promise<{ ok: true, trimmed: string, key: string } | { ok: false, status: number, error: string }>}
 */
async function assertUsernameAvailable(supabase, uid, newUsername) {
  const trimmed = String(newUsername ?? '').trim();
  const key = normalizedUsernameKey(trimmed);
  if (!key) {
    return { ok: false, status: 400, error: 'Username is required' };
  }
  const { data: conflict, error } = await supabase
    .from('users')
    .select('uid')
    .eq('normalized_username', key)
    .neq('uid', uid)
    .maybeSingle();
  if (error) throw error;
  if (conflict) {
    return { ok: false, status: 409, error: 'Username already taken' };
  }
  return { ok: true, trimmed, key };
}

/**
 * Persist username + normalized_username (login uses both).
 */
async function updateUsernameForUid(supabase, companyId, uid, newUsername) {
  const check = await assertUsernameAvailable(supabase, uid, newUsername);
  if (!check.ok) return check;
  const { error } = await supabase
    .from('users')
    .update({
      username: check.trimmed,
      normalized_username: check.key,
      updated_at: new Date().toISOString(),
    })
    .eq('uid', uid)
    .eq('company_id', companyId);
  if (error) {
    return { ok: false, status: 500, error: error.message || 'Failed to update username' };
  }
  return { ok: true, username: check.trimmed, normalized_username: check.key };
}

module.exports = {
  findUserByUsernameInCompany,
  assertUsernameAvailable,
  updateUsernameForUid,
};
