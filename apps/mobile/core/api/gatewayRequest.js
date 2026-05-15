/**
 * Authenticated API Gateway helpers.
 * Privileged auth-service routes require X-User-Context so the backend can
 * derive company_id from the caller (never trust client-supplied tenant).
 */
import { supabase } from '../config/supabase';
import { requireValidCompanyId } from '../tenant/tenantScope';

/**
 * Normalize AuthContext / users row into the shape auth-service expects.
 * @param {object|null|undefined} user
 * @returns {{ uid: string, role: string, company_id: string|null, companyId: string|null, department?: string, username?: string }|null}
 */
export function toRequesterContext(user) {
  if (!user?.uid || !user?.role) {
    return null;
  }
  const companyRaw = user.companyId ?? user.company_id;
  const companyId = requireValidCompanyId(companyRaw, 'requester');
  return {
    uid: String(user.uid),
    role: String(user.role),
    company_id: companyId,
    companyId,
    department: user.department != null ? String(user.department) : '',
    username: user.username != null ? String(user.username) : undefined,
  };
}

/**
 * Build headers for gateway mutations (POST/PATCH/DELETE on /api/auth/users*).
 * @param {object|null|undefined} requester
 * @param {Record<string, string>} [extra]
 */
export function buildGatewayAuthHeaders(requester, extra = {}) {
  const ctx = toRequesterContext(requester);
  if (!ctx) {
    return { 'Content-Type': 'application/json', ...extra };
  }
  return {
    'Content-Type': 'application/json',
    'X-User-Context': JSON.stringify(ctx),
    ...extra,
  };
}

/**
 * Resolve caller identity from the active Supabase session + public.users row.
 * @returns {Promise<ReturnType<typeof toRequesterContext>>}
 */
export async function resolveCurrentRequester() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user?.id) {
    return null;
  }

  const { data: row, error: rowError } = await supabase
    .from('users')
    .select('uid, username, role, company_id, department')
    .eq('uid', session.user.id)
    .maybeSingle();

  if (!rowError && row?.uid && row?.role) {
    return toRequesterContext({
      uid: row.uid,
      username: row.username,
      role: row.role,
      companyId: row.company_id,
      department: row.department,
    });
  }

  const meta = session.user.user_metadata || {};
  return toRequesterContext({
    uid: session.user.id,
    username: meta.username,
    role: meta.role,
    companyId: meta.company_id,
    department: meta.department,
  });
}
