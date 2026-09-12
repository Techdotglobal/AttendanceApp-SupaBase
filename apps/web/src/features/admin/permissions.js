/**
 * Re-exports from shared permission catalog (single source of truth).
 */
import {
  MANAGER_PERMISSION_GROUPS,
  ALL_MANAGER_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  TENANT_WIDE_PEOPLE_PERMISSIONS,
  FEATURE_PERMISSIONS,
  hasPermission as catalogHasPermission,
  hasAnyPermission as catalogHasAnyPermission,
  canAccessFeature as catalogCanAccessFeature,
  isSuperAdmin,
  hasTenantWidePeopleAccess,
} from '@shared/permissions/catalog.cjs';

export const managerPermissionGroups = MANAGER_PERMISSION_GROUPS;
export const allManagerPermissions = ALL_MANAGER_PERMISSIONS;
export const defaultManagerPermissions = DEFAULT_MANAGER_PERMISSIONS;
export { TENANT_WIDE_PEOPLE_PERMISSIONS, FEATURE_PERMISSIONS, isSuperAdmin, hasTenantWidePeopleAccess };

export const PERMISSIONS = {
  CREATE_USER: 'create_user',
  EDIT_USER: 'edit_user',
  DELETE_USER: 'delete_user',
  ACTIVATE_USER: 'activate_user',
  DEACTIVATE_USER: 'deactivate_user',
  CHANGE_USER_ROLE: 'change_user_role',
  VIEW_EMPLOYEES: 'view_employees',
  MANUAL_ATTENDANCE: 'manual_attendance',
  VIEW_ATTENDANCE: 'view_attendance',
  EXPORT_ATTENDANCE: 'export_attendance',
  ATTENDANCE_ANALYTICS: 'attendance_analytics',
  VIEW_LEAVE_REQUESTS: 'view_leave_requests',
  CREATE_LEAVE_REQUEST: 'create_leave_request',
  APPROVE_LEAVE: 'approve_leave',
  REJECT_LEAVE: 'reject_leave',
  EDIT_LEAVE_BALANCE: 'edit_leave_balance',
  VIEW_WORK_MODE_REQUESTS: 'view_work_mode_requests',
  APPROVE_WORK_MODE: 'approve_work_mode',
  REJECT_WORK_MODE: 'reject_work_mode',
  VIEW_TICKETS: 'view_tickets',
  MANAGE_TICKETS: 'manage_tickets',
  ASSIGN_TICKETS: 'assign_tickets',
  CLOSE_TICKETS: 'close_tickets',
  MANAGE_GEOFENCING: 'manage_geofencing',
  UPDATE_OFFICE_LOCATION: 'update_office_location',
  UPDATE_ATTENDANCE_RADIUS: 'update_attendance_radius',
  VIEW_HR_DASHBOARD: 'view_hr_dashboard',
  VIEW_ANALYTICS: 'view_analytics',
  EXPORT_REPORTS: 'export_reports',
  CREATE_EVENTS: 'create_events',
  EDIT_EVENTS: 'edit_events',
  DELETE_EVENTS: 'delete_events',
  MANAGE_NOTIFICATIONS: 'manage_notifications',
  APPROVE_SIGNUP_REQUESTS: 'approve_signup_requests',
  MANAGE_DEPARTMENTS: 'manage_departments',
  MANAGE_APPROVAL_WORKFLOWS: 'manage_approval_workflows',
  ACCESS_SYSTEM_SETTINGS: 'access_system_settings',
};

export const hasPermission = catalogHasPermission;
export const hasAnyPermission = catalogHasAnyPermission;
export const canAccessFeature = catalogCanAccessFeature;

export const hasAllPermissions = (user, permissions = []) => {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  return permissions.every((permission) => hasPermission(user, permission));
};
