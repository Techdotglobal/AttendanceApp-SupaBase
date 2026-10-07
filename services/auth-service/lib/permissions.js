/**
 * Server-side authorization. The shared catalog remains the public contract,
 * while permission_grants adds scope and delegation metadata. Legacy
 * manager_permissions rows are always merged as a compatibility fallback.
 */
const catalog = require('../../../shared/permissions/catalog.cjs');
const {
  MANAGER_PERMISSION_GROUPS,
  ALL_MANAGER_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  TENANT_WIDE_PEOPLE_PERMISSIONS,
  FEATURE_PERMISSIONS,
  PERMISSION_SCOPES,
  PERMISSION_DEFINITIONS,
  normalizePermissionKey,
} = catalog;

const SELF_PROTECTION_ERROR = 'You cannot modify your own administrative access.';
const SCOPE_LEVEL = { OWN: 1, DEPARTMENT: 2, ASSIGNED_DEPARTMENTS: 2, COMPANY: 3 };

function normalizeScope(scope) {
  const value = String(scope || '').trim().toUpperCase();
  return PERMISSION_SCOPES.includes(value) ? value : null;
}

function legacyScope(permissionKey, user = {}) {
  if (TENANT_WIDE_PEOPLE_PERMISSIONS.includes(permissionKey)) return { scope_type: 'COMPANY', department_id: null };
  const departmentId = user.department_id || user.departmentId || null;
  return departmentId
    ? { scope_type: 'DEPARTMENT', department_id: String(departmentId) }
    : { scope_type: 'COMPANY', department_id: null };
}

async function getUserDepartmentIds(supabase, uid, fallback = null, options = {}) {
  if (!uid) return [];
  const cache = options.cache;
  const fallbackDepartment = fallback?.department_id || fallback?.departmentId || '';
  const cacheKey = `${String(uid)}:${String(fallbackDepartment)}`;
  if (cache?.departments?.has(cacheKey)) return cache.departments.get(cacheKey);
  let resolved = null;
  try {
    const { data, error } = await supabase
      .from('user_department_assignments')
      .select('department_id, is_primary')
      .eq('user_uid', uid)
      .eq('is_active', true)
      .order('is_primary', { ascending: false });
    if (!error && Array.isArray(data) && data.length) resolved = data.map((row) => String(row.department_id));
  } catch (_) {
    // The additive migration may not have been deployed yet.
  }
  if (!resolved) resolved = fallbackDepartment ? [String(fallbackDepartment)] : [];
  if (cache?.departments) cache.departments.set(cacheKey, resolved);
  return resolved;
}

async function getEffectiveGrants(supabase, userOrUid, options = {}) {
  const user = typeof userOrUid === 'string' ? { uid: userOrUid } : (userOrUid || {});
  if (!user.uid) return [];
  const companyId = options.companyId || user.company_id || user.companyId || null;
  const cache = options.cache;
  const cacheKey = `${String(companyId || '')}:${String(user.uid)}:${String(user.role || '')}`;
  if (cache?.grants?.has(cacheKey)) return cache.grants.get(cacheKey);
  const grants = [];

  try {
    let query = supabase
      .from('permission_grants')
      .select('id, company_id, principal_uid, permission_key, granted, scope_type, department_id, source, delegated_by_uid')
      .eq('principal_uid', user.uid)
      .eq('granted', true);
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query;
    if (!error) grants.push(...(data || []));
  } catch (_) {
    // Continue with the legacy projection below.
  }

  // Always merge legacy rows for managers. This preserves access when a
  // tenant has not been backfilled or when an older admin client writes only
  // manager_permissions.
  if (String(user.role || '').toLowerCase() === 'manager') {
    try {
      const { data, error } = await supabase
        .from('manager_permissions')
        .select('permission_key, granted')
        .eq('manager_uid', user.uid)
        .eq('granted', true);
      if (!error) {
        for (const row of data || []) {
          if (!ALL_MANAGER_PERMISSIONS.includes(row.permission_key)) continue;
          const legacy = legacyScope(row.permission_key, user);
          if (!grants.some((g) => g.permission_key === row.permission_key && g.scope_type === legacy.scope_type && String(g.department_id || '') === String(legacy.department_id || ''))) {
            grants.push({
              principal_uid: user.uid,
              company_id: companyId,
              permission_key: row.permission_key,
              granted: true,
              ...legacy,
              source: 'legacy_manager',
            });
          }
        }
      }
    } catch (_) {
      // Legacy table is expected to exist, but a failed read must not expose
      // permissions; the canonical rows above remain authoritative.
    }
  }

  if (cache?.grants) cache.grants.set(cacheKey, grants);
  return grants;
}

async function getManagerPermissions(supabase, managerUid) {
  const grants = await getEffectiveGrants(supabase, { uid: managerUid, role: 'manager' });
  return [...new Set(grants.map((row) => row.permission_key).filter((key) => ALL_MANAGER_PERMISSIONS.includes(key)))];
}

async function scopeMatches(supabase, requester, grant, target = {}, options = {}) {
  const scope = normalizeScope(grant.scope_type);
  if (!scope) return false;
  if (!target || Object.keys(target).length === 0) return true;

  const requesterCompany = String(requester.company_id || requester.companyId || target.companyId || '');
  if (target.companyId && requesterCompany && String(target.companyId) !== requesterCompany) return false;
  if (scope === 'COMPANY') return true;
  if (scope === 'OWN') {
    const owner = target.ownerUid || target.userUid || target.employeeUid || target.principalUid;
    return owner != null && String(owner) === String(requester.uid);
  }

  const targetDepartmentIds = Array.isArray(target.departmentIds)
    ? target.departmentIds.map(String)
    : [];
  let targetDepartmentId = target.departmentId || target.department_id || null;
  if (!targetDepartmentId && target.department && requesterCompany) {
    const { data: department } = await supabase
      .from('departments')
      .select('id')
      .eq('company_id', requesterCompany)
      .ilike('name', String(target.department).trim())
      .maybeSingle();
    targetDepartmentId = department?.id || null;
  }
  if (!targetDepartmentId && !targetDepartmentIds.length) return false;
  const targetDepartments = targetDepartmentIds.length ? targetDepartmentIds : [String(targetDepartmentId)];
  if (scope === 'DEPARTMENT') return targetDepartments.includes(String(grant.department_id));
  if (scope === 'ASSIGNED_DEPARTMENTS') {
    const assigned = await getUserDepartmentIds(supabase, requester.uid, requester, options);
    return targetDepartments.some((departmentId) => assigned.includes(String(departmentId)));
  }
  return false;
}

async function hasPermission(supabase, requester, permissionKey, target = null, options = {}) {
  if (!requester?.uid || !requester?.role) return false;
  if (String(requester.role).toLowerCase() === 'super_admin') return true;
  const key = normalizePermissionKey(permissionKey);
  if (!ALL_MANAGER_PERMISSIONS.includes(key)) return false;
  const grants = await getEffectiveGrants(supabase, requester, options);
  for (const grant of grants.filter((row) => row.permission_key === key && row.granted === true)) {
    if (await scopeMatches(supabase, requester, grant, target, options)) return true;
  }
  return false;
}

async function hasAnyPermission(supabase, requester, permissionKeys = [], target = null) {
  for (const key of permissionKeys) {
    if (await hasPermission(supabase, requester, key, target)) return true;
  }
  return false;
}

async function resolveScopedUserUids(supabase, requester, companyId, permissionKey) {
  if (requester?.role === 'super_admin') return null;
  const { data: users, error } = await supabase
    .from('users')
    .select('uid, department, department_id')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (error) throw error;
  let assignments = [];
  try {
    const { data } = await supabase
      .from('user_department_assignments')
      .select('user_uid, department_id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .in('user_uid', (users || []).map((user) => user.uid));
    assignments = data || [];
  } catch (_) {
    assignments = [];
  }
  const departmentMap = new Map();
  for (const assignment of assignments) {
    const key = String(assignment.user_uid);
    const list = departmentMap.get(key) || [];
    list.push(String(assignment.department_id));
    departmentMap.set(key, list);
  }
  const visible = [];
  for (const user of users || []) {
    if (await hasPermission(supabase, { ...requester, company_id: companyId }, permissionKey, {
      companyId,
      targetUid: user.uid,
      userUid: user.uid,
      employeeUid: user.uid,
      departmentId: user.department_id,
      departmentIds: departmentMap.get(String(user.uid)) || undefined,
      department: user.department,
    })) visible.push(user.uid);
  }
  return visible;
}

async function requirePermission(supabase, requester, permissionKey, res, target = null) {
  const allowed = await hasPermission(supabase, requester, permissionKey, target);
  if (!allowed) {
    res.status(403).json({ success: false, error: `Permission required: ${permissionKey}` });
    return false;
  }
  return true;
}

function rejectSelfAdministrativeChange(requester, targetUid, res) {
  if (requester?.uid && targetUid && String(requester.uid) === String(targetUid)) {
    res.status(403).json({ success: false, error: SELF_PROTECTION_ERROR });
    return true;
  }
  return false;
}

function scopeCanDelegate(callerScope, requestedScope) {
  const caller = SCOPE_LEVEL[normalizeScope(callerScope)] || 0;
  const requested = SCOPE_LEVEL[normalizeScope(requestedScope)] || 0;
  return caller > 0 && requested > 0 && requested <= caller;
}

async function canDelegatePermission(supabase, requester, targetUid, permissionKey, scopeType, departmentId = null) {
  if (!targetUid || String(targetUid) === String(requester?.uid)) return false;
  const requesterCompany = requester.company_id || requester.companyId;
  if (!requesterCompany) return false;
  const { data: target } = await supabase
    .from('users')
    .select('uid, company_id, department_id, department, role, is_active')
    .eq('uid', targetUid)
    .maybeSingle();
  if (!target || target.is_active === false || target.role === 'super_admin'
      || String(target.company_id) !== String(requesterCompany)) return false;
  const requestedScope = normalizeScope(scopeType);
  if (!requestedScope) return false;
  if (requestedScope === 'DEPARTMENT' && !departmentId) return false;
  const definition = PERMISSION_DEFINITIONS[permissionKey];
  if (!definition) return false;
  if (definition && definition.delegable === false) return false;
  if (String(requester?.role || '').toLowerCase() === 'super_admin') return true;
  const targetDepartmentIds = await getUserDepartmentIds(supabase, targetUid, target);
  const requesterDepartmentIds = await getUserDepartmentIds(supabase, requester.uid, requester);
  const grants = await getEffectiveGrants(supabase, requester);
  const coversScope = (grant) => {
    const grantScope = normalizeScope(grant.scope_type);
    if (!grantScope) return false;
    if (requestedScope === 'COMPANY') return grantScope === 'COMPANY';
    if (requestedScope === 'ASSIGNED_DEPARTMENTS') {
      // Assigned-department authority is broader than one fixed department;
      // it can only be delegated by an explicit assigned-departments or
      // company grant, never by a DEPARTMENT grant.
      return grantScope === 'COMPANY' || grantScope === 'ASSIGNED_DEPARTMENTS';
    }
    if (requestedScope === 'DEPARTMENT') {
      if (grantScope === 'COMPANY') return true;
      if (grantScope === 'ASSIGNED_DEPARTMENTS') return requesterDepartmentIds.includes(String(departmentId));
      return grantScope === 'DEPARTMENT' && String(grant.department_id) === String(departmentId);
    }
    // OWN is the narrowest grant and may be delegated from any effective
    // scope, subject to the target and permission checks below.
    return scopeCanDelegate(grantScope, requestedScope);
  };
  const targetIsCovered = (grant) => {
    const grantScope = normalizeScope(grant.scope_type);
    if (grantScope === 'COMPANY') return true;
    if (!targetDepartmentIds.length) return false;
    if (grantScope === 'DEPARTMENT') {
      return requestedScope === 'DEPARTMENT'
        ? targetDepartmentIds.includes(String(departmentId)) && String(grant.department_id) === String(departmentId)
        : targetDepartmentIds.includes(String(grant.department_id));
    }
    if (grantScope === 'ASSIGNED_DEPARTMENTS') {
      return targetDepartmentIds.every((id) => requesterDepartmentIds.includes(String(id)));
    }
    return false;
  };
  const canAssign = grants.some((grant) =>
    grant.permission_key === 'assign_user_permissions' && coversScope(grant)
  );
  const hasDelegatedCapability = grants.some((grant) => grant.permission_key === permissionKey && coversScope(grant));
  if (!canAssign || !hasDelegatedCapability) return false;
  const coveringGrants = grants.filter((grant) => grant.permission_key === 'assign_user_permissions' && coversScope(grant));
  let targetCovered = false;
  for (const grant of coveringGrants) {
    const result = await targetIsCovered(grant);
    if (result) { targetCovered = true; break; }
  }
  if (!targetCovered) return false;
  return true;
}

async function writeAuthorizationAudit(supabase, entry) {
  try {
    const { error } = await supabase.from('authorization_audit_logs').insert({
      company_id: entry.companyId,
      actor_uid: entry.actorUid || null,
      target_uid: entry.targetUid || null,
      action: entry.action,
      permission_key: entry.permissionKey || null,
      scope_type: entry.scopeType || null,
      department_id: entry.departmentId || null,
      before_state: entry.beforeState || {},
      after_state: entry.afterState || {},
      metadata: entry.metadata || {},
    });
    if (error) console.warn('[authorization_audit_logs] write failed:', error.message);
  } catch (error) {
    console.warn('[authorization_audit_logs] write failed:', error.message);
  }
}

async function upsertPermissionGrant(supabase, {
  companyId,
  principalUid,
  permissionKey,
  granted = true,
  scopeType = 'DEPARTMENT',
  departmentId = null,
  source = 'delegated',
  delegatedByUid = null,
}) {
  if (!companyId || !principalUid || !permissionKey || !normalizeScope(scopeType)) return null;
  const scope = normalizeScope(scopeType);
  const base = supabase
    .from('permission_grants')
    .select('id')
    .eq('principal_uid', principalUid)
    .eq('permission_key', permissionKey)
    .eq('scope_type', scope)
    .limit(1);
  const { data: existing, error: findError } = scope === 'DEPARTMENT'
    ? await base.eq('department_id', departmentId).maybeSingle()
    : await base.is('department_id', null).maybeSingle();
  if (findError) throw findError;
  const payload = {
    company_id: companyId,
    principal_uid: principalUid,
    permission_key: permissionKey,
    granted: Boolean(granted),
    scope_type: scope,
    department_id: scope === 'DEPARTMENT' ? departmentId : null,
    source,
    delegated_by_uid: delegatedByUid,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    const { data, error } = await supabase.from('permission_grants').update(payload).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('permission_grants').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function writeAuditLog(supabase, { actorUid, targetUid, action }) {
  if (!actorUid || !targetUid || !action) return;
  const { error } = await supabase.from('audit_logs').insert({ actor_uid: actorUid, target_uid: targetUid, action });
  if (error) console.warn('[audit_logs] write failed:', error.message);
}

module.exports = {
  ...catalog,
  MANAGER_PERMISSION_GROUPS,
  ALL_MANAGER_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  TENANT_WIDE_PEOPLE_PERMISSIONS,
  FEATURE_PERMISSIONS,
  PERMISSION_SCOPES,
  PERMISSION_DEFINITIONS,
  SELF_PROTECTION_ERROR,
  normalizeScope,
  getUserDepartmentIds,
  getEffectiveGrants,
  getManagerPermissions,
  hasPermission,
  hasAnyPermission,
  resolveScopedUserUids,
  requirePermission,
  rejectSelfAdministrativeChange,
  scopeCanDelegate,
  canDelegatePermission,
  upsertPermissionGrant,
  writeAuthorizationAudit,
  writeAuditLog,
};
