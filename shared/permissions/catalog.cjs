/**
 * Single source of truth for manager permissions, features, and approval metadata.
 * Consumed by auth-service (require), web (Vite alias), and mobile (Metro).
 */

const MANAGER_PERMISSION_GROUPS = [
  {
    group: 'User Management',
    permissions: [
      ['create_user', 'Create Users'],
      ['edit_user', 'Edit Users'],
      ['delete_user', 'Delete Users'],
      ['activate_user', 'Activate Users'],
      ['deactivate_user', 'Deactivate Users'],
      ['change_user_role', 'Change User Roles'],
      ['assign_user_department', 'Assign User Departments'],
      ['assign_user_permissions', 'Assign User Permissions'],
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
      ['manage_attendance_rules', 'Manage Attendance Rules'],
    ],
  },
  {
    group: 'Leave',
    permissions: [
      ['view_leave_requests', 'View Leave Requests'],
      ['create_leave_request', 'Create Leave Requests'],
      ['approve_leave', 'Approve Leave'],
      ['reject_leave', 'Reject Leave'],
      ['edit_leave_balance', 'Edit Leave Balance'],
    ],
  },
  {
    group: 'Work Mode',
    permissions: [
      ['view_work_mode_requests', 'View Work Mode Requests'],
      ['approve_work_mode', 'Approve Work Mode'],
      ['reject_work_mode', 'Reject Work Mode'],
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
      ['view_reports', 'View Reports'],
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
      ['manage_approval_workflows', 'Manage Approval Workflows'],
      ['access_system_settings', 'Access System Settings'],
      ['manage_workflows', 'Manage Workflows'],
      ['view_payroll', 'View Payroll'],
      ['manage_payroll', 'Manage Payroll'],
    ],
  },
];

const ALL_MANAGER_PERMISSIONS = MANAGER_PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map(([key]) => key)
);

const PERMISSION_SCOPES = ['OWN', 'DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'];

const PERMISSION_DEFINITIONS = Object.freeze({
  view_attendance: { resource: 'attendance', action: 'view', scopes: PERMISSION_SCOPES },
  manual_attendance: { resource: 'attendance', action: 'manage', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'] },
  manage_attendance_rules: { resource: 'attendance', action: 'configure', scopes: ['COMPANY'], delegable: false },
  view_leave_requests: { resource: 'leave', action: 'view', scopes: PERMISSION_SCOPES },
  create_leave_request: { resource: 'leave', action: 'create', scopes: ['OWN', 'DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'] },
  approve_leave: { resource: 'leave', action: 'approve', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  reject_leave: { resource: 'leave', action: 'reject', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  view_employees: { resource: 'users', action: 'view', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  create_user: { resource: 'users', action: 'create', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  edit_user: { resource: 'users', action: 'edit', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  assign_user_department: { resource: 'users', action: 'assign_department', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  assign_user_permissions: { resource: 'users', action: 'assign_permissions', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  change_user_role: { resource: 'users', action: 'assign_system_role', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: false },
  view_payroll: { resource: 'payroll', action: 'view', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: true },
  manage_payroll: { resource: 'payroll', action: 'manage', scopes: ['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'], delegable: false },
});

const DEFAULT_MANAGER_PERMISSIONS = [
  'view_employees',
  'edit_user',
  'manual_attendance',
  'view_attendance',
  'view_leave_requests',
  'approve_leave',
  'reject_leave',
  'view_work_mode_requests',
  'approve_work_mode',
  'reject_work_mode',
  'view_tickets',
  'manage_tickets',
  'view_hr_dashboard',
  'view_analytics',
  'create_events',
  'edit_events',
  'delete_events',
];

const TENANT_WIDE_PEOPLE_PERMISSIONS = [
  'view_employees',
  'create_user',
  'edit_user',
  'delete_user',
  'activate_user',
  'deactivate_user',
  'change_user_role',
  'approve_signup_requests',
];

const FEATURE_PERMISSIONS = {
  dashboard: [],
  users: ['view_employees', 'create_user', 'edit_user'],
  departments: ['manage_departments'],
  sites: ['manage_geofencing'],
  attendance: ['view_attendance', 'manual_attendance'],
  attendanceRules: ['manage_attendance_rules'],
  leaves: ['view_leave_requests'],
  workModeRequests: ['view_work_mode_requests'],
  tickets: ['view_tickets', 'manage_tickets', 'assign_tickets', 'close_tickets'],
  calendar: ['create_events', 'edit_events', 'delete_events'],
  analytics: ['view_analytics', 'view_hr_dashboard'],
  reports: ['export_reports', 'view_reports'],
  settings: ['access_system_settings'],
  permissions: [],
  notifications: ['manage_notifications'],
  approvalWorkflows: ['manage_approval_workflows'],
  // No manager permission grants payroll access (spec: managers do not get
  // payroll access merely by managing attendance/leave) — the route/nav is
  // additionally guarded with superAdminOnly so this stays super_admin-only
  // even though an empty array would otherwise let any authenticated role in.
  payroll: ['view_payroll', 'manage_payroll'],
};

// Employees do not have rows in manager_permissions. These are the safe,
// read/submit features available to every employee account in the web portal;
// the API still scopes every employee request to the authenticated user.
const EMPLOYEE_FEATURES = [
  'attendance',
  'leaves',
  'tickets',
  'calendar',
  'notifications',
];

const REQUEST_TYPES = {
  ANNUAL_LEAVE: 'annual_leave',
  SICK_LEAVE: 'sick_leave',
  CASUAL_LEAVE: 'casual_leave',
  REMOTE_WORK: 'remote_work',
};

const LEAVE_TYPE_TO_REQUEST_TYPE = {
  annual: REQUEST_TYPES.ANNUAL_LEAVE,
  sick: REQUEST_TYPES.SICK_LEAVE,
  casual: REQUEST_TYPES.CASUAL_LEAVE,
};

const APPROVER_ROLES = {
  DEPARTMENT_MANAGER: 'department_manager',
  HR: 'hr',
  SUPER_ADMIN: 'super_admin',
};

const DEFAULT_WORKFLOW_TEMPLATES = {
  [REQUEST_TYPES.ANNUAL_LEAVE]: [
    { step_order: 1, step_label: 'Team Lead', approver_role: APPROVER_ROLES.DEPARTMENT_MANAGER },
    { step_order: 2, step_label: 'HR', approver_role: APPROVER_ROLES.HR },
    { step_order: 3, step_label: 'Super Admin', approver_role: APPROVER_ROLES.SUPER_ADMIN },
  ],
  [REQUEST_TYPES.SICK_LEAVE]: [
    { step_order: 1, step_label: 'HR', approver_role: APPROVER_ROLES.HR },
  ],
  [REQUEST_TYPES.CASUAL_LEAVE]: [
    { step_order: 1, step_label: 'Team Lead', approver_role: APPROVER_ROLES.DEPARTMENT_MANAGER },
    { step_order: 2, step_label: 'HR', approver_role: APPROVER_ROLES.HR },
  ],
  [REQUEST_TYPES.REMOTE_WORK]: [
    { step_order: 1, step_label: 'Manager', approver_role: APPROVER_ROLES.DEPARTMENT_MANAGER },
    { step_order: 2, step_label: 'HR', approver_role: APPROVER_ROLES.HR },
  ],
};

function normalizePermissionKey(key) {
  return String(key || '').trim();
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function hasPermission(user, permissionKey) {
  if (!user || !permissionKey) return false;
  const role = normalizeRole(user.role);
  if (role === 'super_admin') return true;
  const key = normalizePermissionKey(permissionKey);
  if (!ALL_MANAGER_PERMISSIONS.includes(key)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

function hasAnyPermission(user, permissionKeys = []) {
  if (!user) return false;
  const role = normalizeRole(user.role);
  if (role === 'super_admin') return true;
  const keys = permissionKeys.map(normalizePermissionKey).filter((k) => ALL_MANAGER_PERMISSIONS.includes(k));
  if (keys.length === 0) return false;
  return keys.some((k) => user.permissions?.includes(k));
}

function getGrantScopes(user, permissionKey) {
  const key = normalizePermissionKey(permissionKey);
  if (!user || !key) return [];
  if (normalizeRole(user.role) === 'super_admin') return [...PERMISSION_SCOPES];
  const grants = Array.isArray(user.grants) ? user.grants : [];
  const scoped = grants
    .filter((grant) => grant?.permission_key === key && grant?.granted !== false)
    .map((grant) => grant.scope_type)
    .filter((scope) => PERMISSION_SCOPES.includes(scope));
  if (scoped.length) return [...new Set(scoped)];
  return hasPermission(user, key) ? ['DEPARTMENT'] : [];
}

function canAccessFeature(user, feature) {
  const required = FEATURE_PERMISSIONS[feature];
  if (!user) return false;
  const role = normalizeRole(user.role);
  if (role === 'super_admin') return true;
  if (role === 'employee' && !required.some((key) => hasPermission(user, key))) {
    return EMPLOYEE_FEATURES.includes(feature);
  }
  if (!required || required.length === 0) return true;
  return hasAnyPermission(user, required);
}

function isSuperAdmin(user) {
  return normalizeRole(user?.role) === 'super_admin';
}

function hasTenantWidePeopleAccess(user) {
  if (!user) return false;
  if (normalizeRole(user.role) === 'super_admin') return true;
  return hasAnyPermission(user, TENANT_WIDE_PEOPLE_PERMISSIONS);
}

module.exports = {
  MANAGER_PERMISSION_GROUPS,
  ALL_MANAGER_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  PERMISSION_SCOPES,
  PERMISSION_DEFINITIONS,
  TENANT_WIDE_PEOPLE_PERMISSIONS,
  FEATURE_PERMISSIONS,
  EMPLOYEE_FEATURES,
  REQUEST_TYPES,
  LEAVE_TYPE_TO_REQUEST_TYPE,
  APPROVER_ROLES,
  DEFAULT_WORKFLOW_TEMPLATES,
  normalizePermissionKey,
  normalizeRole,
  getGrantScopes,
  hasPermission,
  hasAnyPermission,
  canAccessFeature,
  isSuperAdmin,
  hasTenantWidePeopleAccess,
};
