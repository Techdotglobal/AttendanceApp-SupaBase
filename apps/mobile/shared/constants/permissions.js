export const MANAGER_PERMISSIONS = {
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
  APPROVE_LEAVE: 'approve_leave',
  REJECT_LEAVE: 'reject_leave',
  EDIT_LEAVE_BALANCE: 'edit_leave_balance',
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
  ACCESS_SYSTEM_SETTINGS: 'access_system_settings',
};

export const hasPermission = (user, permissionKey) => {
  if (!user || !permissionKey) return false;
  if (user.role === 'super_admin') return true;
  if (user.role !== 'manager') return false;
  return Array.isArray(user.permissions) && user.permissions.includes(permissionKey);
};

export const hasAnyPermission = (user, permissionKeys) =>
  permissionKeys.some((permissionKey) => hasPermission(user, permissionKey));

export const isSelfTarget = (user, target) => {
  const targetUid = target?.uid || (typeof target?.id === 'string' && target.id.startsWith('emp_')
    ? target.id.slice(4)
    : target?.id);
  return Boolean(user?.uid && targetUid && String(user.uid) === String(targetUid));
};
