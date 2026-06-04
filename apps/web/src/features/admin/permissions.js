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
