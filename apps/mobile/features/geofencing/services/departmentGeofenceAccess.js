/**
 * Department-scoped geofence permissions and department resolution.
 */
import { supabase } from '../../../core/config/supabase';
import { fetchSessionUserCompanyId } from '../../../core/tenant/tenantScope';
import { fetchTenantDepartments } from '../../../core/api/tenantOrgApi';
import { departmentLookupKey, departmentNamesMatch } from '../../../utils/orgNormalize';
import { ROLES } from '../../../shared/constants/roles';

/**
 * @param {object|null} user
 * @returns {string|null}
 */
export function getUserDepartmentId(user) {
  if (!user) return null;
  const id = user.departmentId ?? user.department_id;
  return id != null && String(id).trim() !== '' ? String(id) : null;
}

/**
 * Resolve department UUID from user profile (department_id or name lookup).
 * @param {object} user
 * @returns {Promise<string|null>}
 */
export async function resolveUserDepartmentId(user) {
  const direct = getUserDepartmentId(user);
  if (direct) return direct;

  const deptName = user?.department;
  if (!deptName || String(deptName).trim() === '') return null;

  const companyId = user?.companyId ?? user?.company_id ?? (await fetchSessionUserCompanyId(supabase));
  if (!companyId) return null;

  const apiResult = await fetchTenantDepartments(user);
  if (apiResult.success && Array.isArray(apiResult.data)) {
    const match = apiResult.data.find((d) => departmentNamesMatch(d.name, deptName));
    if (match?.id) return String(match.id);
  }

  const { data, error } = await supabase
    .from('departments')
    .select('id, name, normalized_name')
    .eq('company_id', companyId);

  if (error || !data?.length) return null;

  const key = departmentLookupKey(deptName);
  const row = data.find(
    (d) =>
      departmentLookupKey(d.normalized_name) === key ||
      departmentLookupKey(d.name) === key
  );
  return row?.id ? String(row.id) : null;
}

/**
 * Super admins manage all departments; managers only their own.
 * @param {object|null} user
 * @param {string|null} targetDepartmentId
 * @returns {boolean}
 */
export function canManageDepartmentGeofence(user, targetDepartmentId) {
  if (!user) return false;
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (!targetDepartmentId) return false;
  if (user.role !== ROLES.MANAGER) return false;

  const userDeptId = getUserDepartmentId(user);
  if (userDeptId && String(userDeptId) === String(targetDepartmentId)) return true;

  return false;
}

/**
 * Async permission check including department name fallback for managers without department_id.
 * @param {object} user
 * @param {string} targetDepartmentId
 * @returns {Promise<boolean>}
 */
export async function canManageDepartmentGeofenceAsync(user, targetDepartmentId) {
  if (!user) return false;
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (canManageDepartmentGeofence(user, targetDepartmentId)) return true;
  if (user.role !== ROLES.MANAGER || !targetDepartmentId) return false;

  const resolved = await resolveUserDepartmentId(user);
  return resolved != null && String(resolved) === String(targetDepartmentId);
}

/**
 * @param {object} user
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function listManageableDepartments(user) {
  if (!user) return [];

  if (user.role === ROLES.SUPER_ADMIN) {
    const result = await fetchTenantDepartments(user);
    return result.success ? result.data || [] : [];
  }

  if (user.role === ROLES.MANAGER) {
    const deptId = await resolveUserDepartmentId(user);
    if (!deptId) return [];

    const result = await fetchTenantDepartments(user);
    if (result.success && Array.isArray(result.data)) {
      const match = result.data.find((d) => String(d.id) === String(deptId));
      return match ? [match] : [{ id: deptId, name: user.department || 'My department' }];
    }
    return [{ id: deptId, name: user.department || 'My department' }];
  }

  return [];
}

/**
 * @param {object} row - RPC or sites row
 * @returns {object|null}
 */
export function mapGeofenceRowToOfficeLocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    department_id: row.department_id,
    department_name: row.department_name,
    name: row.site_name || row.name || 'Office',
    latitude: row.latitude,
    longitude: row.longitude,
    radius_meters: row.radius_meters ?? row.radius ?? 1000,
    updated_at: row.updated_at,
    source: row.source || 'department',
  };
}
