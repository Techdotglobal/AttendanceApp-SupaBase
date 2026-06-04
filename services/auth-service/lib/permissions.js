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

const ALL_MANAGER_PERMISSIONS = MANAGER_PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map(([key]) => key)
);

const DEFAULT_MANAGER_PERMISSIONS = [
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

const SELF_PROTECTION_ERROR = 'You cannot modify your own administrative access.';

const normalizePermissionKey = (key) => String(key || '').trim();

async function getManagerPermissions(supabase, managerUid) {
  if (!managerUid) return [];
  const { data, error } = await supabase
    .from('manager_permissions')
    .select('permission_key, granted')
    .eq('manager_uid', managerUid);
  if (error) throw error;
  return (data || [])
    .filter((row) => row.granted === true && ALL_MANAGER_PERMISSIONS.includes(row.permission_key))
    .map((row) => row.permission_key);
}

async function hasPermission(supabase, requester, permissionKey) {
  if (!requester?.role) return false;
  if (requester.role === 'super_admin') return true;
  if (requester.role !== 'manager') return false;
  const key = normalizePermissionKey(permissionKey);
  if (!ALL_MANAGER_PERMISSIONS.includes(key)) return false;
  const { data, error } = await supabase
    .from('manager_permissions')
    .select('granted')
    .eq('manager_uid', requester.uid)
    .eq('permission_key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.granted === true;
}

async function hasAnyPermission(supabase, requester, permissionKeys = []) {
  if (!requester?.role) return false;
  if (requester.role === 'super_admin') return true;
  if (requester.role !== 'manager') return false;
  const keys = permissionKeys.map(normalizePermissionKey).filter((key) => ALL_MANAGER_PERMISSIONS.includes(key));
  if (keys.length === 0) return false;
  const { data, error } = await supabase
    .from('manager_permissions')
    .select('permission_key, granted')
    .eq('manager_uid', requester.uid)
    .in('permission_key', keys);
  if (error) throw error;
  return (data || []).some((row) => row.granted === true);
}

async function requirePermission(supabase, requester, permissionKey, res) {
  const allowed = await hasPermission(supabase, requester, permissionKey);
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

async function writeAuditLog(supabase, { actorUid, targetUid, action }) {
  if (!actorUid || !targetUid || !action) return;
  const { error } = await supabase.from('audit_logs').insert({
    actor_uid: actorUid,
    target_uid: targetUid,
    action,
  });
  if (error) {
    console.warn('[audit_logs] write failed:', error.message);
  }
}

module.exports = {
  MANAGER_PERMISSION_GROUPS,
  ALL_MANAGER_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  SELF_PROTECTION_ERROR,
  getManagerPermissions,
  hasPermission,
  hasAnyPermission,
  requirePermission,
  rejectSelfAdministrativeChange,
  writeAuditLog,
};
