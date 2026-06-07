export const managerPermissionGroups = [
  {
    group: 'User Management',
    permissions: [
      ['create_user', 'Create Users'],
      ['edit_user', 'Edit Users'],
      ['delete_user', 'Delete Users'],
      ['activate_user', 'Activate Users'],
      ['deactivate_user', 'Deactivate Users'],
      ['change_user_role', 'Change User Roles'],
      ['view_employees', 'View Employees'],
    ],
  },
  {
    group: 'Attendance',
    permissions: [
      ['manual_attendance', 'Manual Attendance'],
      ['view_attendance', 'View Attendance'],
      ['export_attendance', 'Export Attendance'],
      ['attendance_analytics', 'Attendance Analytics'],
    ],
  },
  {
    group: 'Leave',
    permissions: [
      ['view_leave_requests', 'View Leave Requests'],
      ['approve_leave', 'Approve Leave'],
      ['reject_leave', 'Reject Leave'],
      ['edit_leave_balance', 'Edit Leave Balance'],
    ],
  },
  {
    group: 'Tickets',
    permissions: [
      ['view_tickets', 'View Tickets'],
      ['manage_tickets', 'Manage Tickets'],
      ['assign_tickets', 'Assign Tickets'],
      ['close_tickets', 'Close Tickets'],
    ],
  },
  {
    group: 'Geofencing',
    permissions: [
      ['manage_geofencing', 'Manage Geofencing'],
      ['update_office_location', 'Update Office Location'],
      ['update_attendance_radius', 'Update Attendance Radius'],
    ],
  },
  {
    group: 'Analytics',
    permissions: [
      ['view_hr_dashboard', 'View HR Dashboard'],
      ['view_analytics', 'View Analytics'],
      ['export_reports', 'Export Reports'],
    ],
  },
  {
    group: 'Calendar',
    permissions: [
      ['create_events', 'Create Events'],
      ['edit_events', 'Edit Events'],
      ['delete_events', 'Delete Events'],
    ],
  },
  {
    group: 'System',
    permissions: [
      ['manage_notifications', 'Manage Notifications'],
      ['approve_signup_requests', 'Approve Signup Requests'],
      ['manage_departments', 'Manage Departments'],
      ['access_system_settings', 'Access System Settings'],
    ],
  },
];

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

export const FEATURE_PERMISSIONS = {
  dashboard: [],
  users: [
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.CREATE_USER,
    PERMISSIONS.EDIT_USER,
    PERMISSIONS.DELETE_USER,
    PERMISSIONS.ACTIVATE_USER,
    PERMISSIONS.DEACTIVATE_USER,
    PERMISSIONS.CHANGE_USER_ROLE,
  ],
  departments: [PERMISSIONS.MANAGE_DEPARTMENTS],
  analytics: [PERMISSIONS.VIEW_ANALYTICS],
  reports: [PERMISSIONS.EXPORT_REPORTS],
  settings: [PERMISSIONS.ACCESS_SYSTEM_SETTINGS],
  permissions: [],
  sites: [PERMISSIONS.MANAGE_GEOFENCING],
  attendance: [PERMISSIONS.MANUAL_ATTENDANCE, PERMISSIONS.VIEW_ATTENDANCE],
  leaves: [PERMISSIONS.VIEW_LEAVE_REQUESTS, PERMISSIONS.APPROVE_LEAVE, PERMISSIONS.REJECT_LEAVE],
  tickets: [
    PERMISSIONS.VIEW_TICKETS,
    PERMISSIONS.MANAGE_TICKETS,
    PERMISSIONS.ASSIGN_TICKETS,
    PERMISSIONS.CLOSE_TICKETS,
  ],
  calendar: [PERMISSIONS.CREATE_EVENTS, PERMISSIONS.EDIT_EVENTS, PERMISSIONS.DELETE_EVENTS],
  notifications: [PERMISSIONS.MANAGE_NOTIFICATIONS],
};

export const allManagerPermissions = managerPermissionGroups.flatMap((group) =>
  group.permissions.map(([key]) => key)
);

export const defaultManagerPermissions = [
  'view_employees',
  'edit_user',
  'manual_attendance',
  'view_attendance',
  'view_leave_requests',
  'approve_leave',
  'reject_leave',
  'view_tickets',
  'manage_tickets',
  'view_hr_dashboard',
  'view_analytics',
  'create_events',
  'edit_events',
  'delete_events',
];

export const isSuperAdmin = (user) => user?.role === 'super_admin';

export const hasPermission = (user, permission) => {
  if (!user || !permission) return false;
  if (isSuperAdmin(user)) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
};

export const hasAnyPermission = (user, permissions = []) => {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  return permissions.some((permission) => hasPermission(user, permission));
};

export const hasAllPermissions = (user, permissions = []) => {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  return permissions.every((permission) => hasPermission(user, permission));
};

export const canAccessFeature = (user, featureKey) => {
  if (isSuperAdmin(user)) return true;
  const permissions = FEATURE_PERMISSIONS[featureKey] || [];
  return permissions.length === 0 || hasAnyPermission(user, permissions);
};
