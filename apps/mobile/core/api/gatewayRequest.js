/**
 * Authenticated API Gateway helpers.
 * Privileged auth-service routes require X-User-Context and/or Authorization Bearer
 * so the backend can derive company_id from the caller (never trust client-supplied tenant).
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
    department_id: user.departmentId ?? user.department_id ?? null,
    username: user.username != null ? String(user.username) : undefined,
  };
}

/**
 * Build headers for gateway mutations.
 * Always prefers a live Supabase access token (Authorization) so identity survives
 * proxies that drop custom headers; also sends X-User-Context when available.
 * @param {object|null|undefined} requester
 * @param {Record<string, string>} [extra]
 * @returns {Promise<Record<string, string>>}
 */
export async function buildGatewayAuthHeaders(requester, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };

  const ctx = toRequesterContext(requester);
  if (ctx) {
    headers['X-User-Context'] = JSON.stringify(ctx);
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[gatewayRequest] getSession for Authorization failed:', e?.message || e);
    }
  }

  return headers;
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
    .select('uid, username, role, company_id, department, department_id')
    .eq('uid', session.user.id)
    .maybeSingle();

  if (!rowError && row?.uid && row?.role) {
    return toRequesterContext({
      uid: row.uid,
      username: row.username,
      role: row.role,
      companyId: row.company_id,
      department: row.department,
      departmentId: row.department_id,
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
