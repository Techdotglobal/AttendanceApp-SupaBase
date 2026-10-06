/**
 * ESM entry for Vite / Metro. CommonJS services continue to use catalog.cjs directly.
 */
import catalog from './catalog.cjs';

export const MANAGER_PERMISSION_GROUPS = catalog.MANAGER_PERMISSION_GROUPS;
export const ALL_MANAGER_PERMISSIONS = catalog.ALL_MANAGER_PERMISSIONS;
export const DEFAULT_MANAGER_PERMISSIONS = catalog.DEFAULT_MANAGER_PERMISSIONS;
export const TENANT_WIDE_PEOPLE_PERMISSIONS = catalog.TENANT_WIDE_PEOPLE_PERMISSIONS;
export const FEATURE_PERMISSIONS = catalog.FEATURE_PERMISSIONS;
export const REQUEST_TYPES = catalog.REQUEST_TYPES;
export const LEAVE_TYPE_TO_REQUEST_TYPE = catalog.LEAVE_TYPE_TO_REQUEST_TYPE;
export const APPROVER_ROLES = catalog.APPROVER_ROLES;
export const DEFAULT_WORKFLOW_TEMPLATES = catalog.DEFAULT_WORKFLOW_TEMPLATES;
export const normalizePermissionKey = catalog.normalizePermissionKey;
export const normalizeRole = catalog.normalizeRole;
export const getGrantScopes = catalog.getGrantScopes;
export const hasPermission = catalog.hasPermission;
export const hasAnyPermission = catalog.hasAnyPermission;
export const canAccessFeature = catalog.canAccessFeature;
export const isSuperAdmin = catalog.isSuperAdmin;
export const hasTenantWidePeopleAccess = catalog.hasTenantWidePeopleAccess;
export const EMPLOYEE_FEATURES = catalog.EMPLOYEE_FEATURES;
export const PERMISSION_SCOPES = catalog.PERMISSION_SCOPES;
export const PERMISSION_DEFINITIONS = catalog.PERMISSION_DEFINITIONS;

export default catalog;
