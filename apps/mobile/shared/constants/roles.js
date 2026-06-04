import { MANAGER_PERMISSIONS, hasAnyPermission } from './permissions';

// User Roles Constants
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee'
};

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.EMPLOYEE]: 'Employee'
};

export const ROLE_DESCRIPTIONS = {
  [ROLES.SUPER_ADMIN]: 'Full system access across all departments',
  [ROLES.MANAGER]: 'Department-level access and management',
  [ROLES.EMPLOYEE]: 'Basic employee access'
};

/**
 * Get role label
 * @param {string} role - Role constant
 * @returns {string} Human-readable label
 */
export const getRoleLabel = (role) => {
  return ROLE_LABELS[role] || 'Unknown';
};

/**
 * Get role description
 * @param {string} role - Role constant
 * @returns {string} Description
 */
export const getRoleDescription = (role) => {
  return ROLE_DESCRIPTIONS[role] || 'Unknown role';
};

/**
 * Check if role is valid
 * @param {string} role - Role to validate
 * @returns {boolean} Is valid role
 */
export const isValidRole = (role) => {
  return Object.values(ROLES).includes(role);
};

/**
 * Check if user has admin privileges
 * @param {string} role - User role
 * @returns {boolean} Has admin privileges
 */
export const isAdmin = (role) => {
  return role === ROLES.SUPER_ADMIN || role === ROLES.MANAGER;
};

/**
 * Check if user is super admin
 * @param {string} role - User role
 * @returns {boolean} Is super admin
 */
export const isSuperAdmin = (role) => {
  return role === ROLES.SUPER_ADMIN;
};

/**
 * Backward-compatible name for managers with tenant-wide people permissions.
 * Department names are organizational only and never grant capabilities.
 */
export const isHRAdmin = (user) => {
  if (!user) return false;
  return user.role === ROLES.MANAGER && hasAnyPermission(user, [
    MANAGER_PERMISSIONS.CREATE_USER,
    MANAGER_PERMISSIONS.DELETE_USER,
    MANAGER_PERMISSIONS.CHANGE_USER_ROLE,
    MANAGER_PERMISSIONS.APPROVE_SIGNUP_REQUESTS,
  ]);
};

/**
 * Department geofence management (super admin: all; manager: own department).
 * HR managers are managers — they use the same rules as other department managers.
 */
export const canManageGeofence = (user, departmentId = null) => {
  if (!user) return false;
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (user.role !== ROLES.MANAGER) return false;
  const targetId = departmentId || user.departmentId || user.department_id;
  const userDeptId = user.departmentId || user.department_id;
  return Boolean(targetId && userDeptId && String(targetId) === String(userDeptId));
};

