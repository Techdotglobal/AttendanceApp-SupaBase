/**
 * Server-side tenant scope for service-role Supabase queries.
 * Requester JSON (e.g. X-User-Context) must include company_id for super_admin/manager.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCompanyId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const id = String(raw).trim();
  return UUID_RE.test(id) ? id : null;
}

/**
 * @param {object|null} requester - parsed X-User-Context
 * @returns {string|null}
 */
function resolveCompanyIdFromRequester(requester) {
  if (!requester) return null;
  return normalizeCompanyId(requester.company_id ?? requester.companyId);
}

/**
 * Load company_id from users row if missing on requester (backward compatible).
 * @param {*} supabase
 * @param {object} requester
 * @returns {Promise<string|null>}
 */
async function ensureRequesterCompanyId(supabase, requester) {
  let cid = resolveCompanyIdFromRequester(requester);
  if (cid || !requester?.uid) return cid;
  const { data, error } = await supabase
    .from('users')
    .select('company_id')
    .eq('uid', requester.uid)
    .maybeSingle();
  if (error || !data?.company_id) return null;
  return normalizeCompanyId(data.company_id);
}

/**
 * @param {*} supabase
 * @param {object} requester
 * @returns {Promise<string|null>}
 */
async function getTenantCompanyId(supabase, requester) {
  const cid = await ensureRequesterCompanyId(supabase, requester);
  if (!cid) {
    console.warn('[tenantScope] requester missing valid company_id (and DB lookup failed)', {
      uid: requester?.uid,
      role: requester?.role,
    });
  }
  return cid;
}

/**
 * @param {*} supabase
 * @param {string} companyId
 * @returns {Promise<string[]>}
 */
async function fetchCompanyUserUids(supabase, companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) return [];
  const { data, error } = await supabase.from('users').select('uid').eq('company_id', cid);
  if (error) {
    console.error('[tenantScope] fetchCompanyUserUids:', error.message);
    return [];
  }
  return (data || []).map((r) => r.uid).filter(Boolean);
}

module.exports = {
  normalizeCompanyId,
  resolveCompanyIdFromRequester,
  ensureRequesterCompanyId,
  getTenantCompanyId,
  fetchCompanyUserUids,
};
