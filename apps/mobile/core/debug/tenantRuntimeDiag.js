/**
 * Temporary multi-tenant runtime diagnostics.
 * Set TENANT_RUNTIME_DIAG to false before production / store release.
 */
import { supabase } from '../config/supabase';

export const TENANT_RUNTIME_DIAG = __DEV__;

export function tenantDiagLog(tag, payload) {
  if (!TENANT_RUNTIME_DIAG) return;
  const line = `[TENANT_DIAG:${tag}]`;
  try {
    if (payload !== undefined) {
      console.log(line, typeof payload === 'string' ? payload : JSON.stringify(payload));
    } else {
      console.log(line);
    }
  } catch (_) {
    console.log(line, payload);
  }
}

/**
 * Same authenticated Supabase client as the app — RLS applies (not service role).
 * Equivalent to: select username, role, is_active, company_id from public.users where company_id = ?
 */
export async function diagQueryUsersByCompanyId(companyId, label = 'session') {
  if (!TENANT_RUNTIME_DIAG || !companyId) {
    return { data: null, error: null, skipped: true };
  }
  const { data, error } = await supabase
    .from('users')
    .select('username, role, is_active, company_id')
    .eq('company_id', companyId)
    .order('username', { ascending: true });

  tenantDiagLog(`users_by_company.${label}`, {
    companyId,
    error: error?.message || null,
    code: error?.code || null,
    rowCount: data?.length ?? 0,
    rows: (data || []).map((r) => ({
      username: r.username,
      role: r.role,
      is_active: r.is_active,
      company_id: r.company_id != null ? String(r.company_id) : null,
    })),
  });

  return { data, error };
}
