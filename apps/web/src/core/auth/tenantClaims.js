/**
 * Tenant fields on the Supabase session JWT: session.user.user_metadata
 * (company_id, role, department), synced from public.users via auth-service.
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

export function hasCompleteTenantClaims(session) {
  const c = getTenantClaimsFromSession(session);
  return Boolean(c.companyId && c.role);
}

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
  if (jwt.companyId !== dbCompany || jwt.role !== dbRole) return false;
  if (jwtDeptRaw.trim() !== dbDept) return false;
  return true;
}

export function shouldSyncTenantMetadata(session, userRow) {
  if (!userRow) return false;
  if (!hasCompleteTenantClaims(session)) return true;
  return !tenantClaimsMatchUserRow(session, userRow);
}
