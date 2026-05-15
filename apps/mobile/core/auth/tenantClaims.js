/**
 * Tenant fields on the Supabase session JWT live under session.user.user_metadata
 * (populated from public.users via trusted server sync — see auth-service sync-metadata).
 */

/**
 * @param {import('@supabase/supabase-js').Session | null | undefined} session
 * @returns {{ companyId: string | null, role: string | null, departmentId: string | null, username: string | null }}
 */
export function getTenantClaimsFromSession(session) {
  const meta = session?.user?.user_metadata;
  if (!meta || typeof meta !== 'object') {
    return { companyId: null, role: null, departmentId: null, username: null };
  }
  const departmentText =
    meta.department != null
      ? String(meta.department).trim()
      : meta.department_id != null
        ? String(meta.department_id).trim()
        : null;
  return {
    companyId: meta.company_id != null ? String(meta.company_id) : null,
    role: meta.role != null ? String(meta.role) : null,
    departmentId: departmentText || null,
    username: meta.username != null ? String(meta.username) : null,
  };
}

/**
 * @param {import('@supabase/supabase-js').Session | null | undefined} session
 * @returns {boolean}
 */
export function hasCompleteTenantClaims(session) {
  const c = getTenantClaimsFromSession(session);
  return Boolean(c.companyId && c.role);
}

/**
 * Compare JWT tenant claims to a public.users row (snake_case). Null-safe.
 * @param {import('@supabase/supabase-js').Session | null | undefined} session
 * @param {object} userRow
 * @returns {boolean}
 */
export function tenantClaimsMatchUserRow(session, userRow) {
  if (!userRow) return false;
  const meta = session?.user?.user_metadata;
  const jwt = getTenantClaimsFromSession(session);
  const dbCompany = userRow.company_id != null ? String(userRow.company_id) : null;
  const dbRole = userRow.role != null ? String(userRow.role) : null;
  const dbDept = userRow.department != null ? String(userRow.department).trim() : '';
  const jwtDeptRaw =
    meta?.department != null
      ? String(meta.department)
      : meta?.department_id != null
        ? String(meta.department_id)
        : jwt.departmentId != null
          ? String(jwt.departmentId)
          : '';
  const jwtDept = jwtDeptRaw.trim();

  if (jwt.companyId !== dbCompany || jwt.role !== dbRole) {
    return false;
  }
  if (jwtDept !== dbDept) {
    return false;
  }
  return true;
}

/**
 * @param {import('@supabase/supabase-js').Session | null | undefined} session
 * @param {object} userRow
 * @returns {boolean}
 */
export function shouldSyncTenantMetadata(session, userRow) {
  if (!userRow) return false;
  if (!hasCompleteTenantClaims(session)) {
    return true;
  }
  return !tenantClaimsMatchUserRow(session, userRow);
}
