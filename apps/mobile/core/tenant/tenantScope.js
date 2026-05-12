/**
 * Multi-tenant query helpers: every tenant-owned Supabase read must be scoped
 * by `company_id` from the authenticated user's profile (or explicit param).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {object|null|undefined} user - AuthContext user or similar
 * @returns {string|null}
 */
export function resolveCompanyIdFromUser(user) {
  if (!user) return null;
  const raw = user.companyId ?? user.company_id;
  if (raw == null || String(raw).trim() === '') return null;
  const id = String(raw).trim();
  return UUID_RE.test(id) ? id : null;
}

/**
 * @param {string|null|undefined} companyId
 * @param {string} context - log label
 * @returns {string|null} normalized UUID or null
 */
export function requireValidCompanyId(companyId, context = 'tenant') {
  if (companyId == null || String(companyId).trim() === '') {
    if (__DEV__) {
      console.warn(`[tenant:${context}] missing company_id — scoped query skipped`);
    }
    return null;
  }
  const id = String(companyId).trim();
  if (!UUID_RE.test(id)) {
    if (__DEV__) {
      console.warn(`[tenant:${context}] invalid company_id shape — scoped query skipped`, id);
    }
    return null;
  }
  return id;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {string} [context]
 * @returns {Promise<string[]>} auth uids for users in this company (all active states)
 */
export async function fetchCompanyUserUids(supabase, companyId, context = 'uids') {
  const cid = requireValidCompanyId(companyId, context);
  if (!cid) return [];
  const { data, error } = await supabase.from('users').select('uid').eq('company_id', cid);
  if (error) {
    console.error(`[tenant:${context}] fetchCompanyUserUids:`, error.message);
    return [];
  }
  const uids = (data || []).map((r) => r.uid).filter(Boolean);
  if (__DEV__) {
    console.log(`[tenant:${context}] company_id=${cid} → ${uids.length} user uids for .in() filters`);
  }
  return uids;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {string} [context]
 * @returns {Promise<string[]>} usernames for users in this company
 */
export async function fetchCompanyUsernames(supabase, companyId, context = 'usernames') {
  const cid = requireValidCompanyId(companyId, context);
  if (!cid) return [];
  const { data, error } = await supabase.from('users').select('username').eq('company_id', cid);
  if (error) {
    console.error(`[tenant:${context}] fetchCompanyUsernames:`, error.message);
    return [];
  }
  return (data || []).map((r) => r.username).filter((u) => u != null && String(u).trim() !== '');
}

/**
 * Company_id for the currently signed-in Supabase user (from public.users).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<string|null>}
 */
export async function fetchSessionUserCompanyId(supabase) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user?.id) return null;
  const { data, error } = await supabase
    .from('users')
    .select('company_id')
    .eq('uid', authData.user.id)
    .maybeSingle();
  if (error || !data?.company_id) return null;
  return requireValidCompanyId(data.company_id, 'session');
}
