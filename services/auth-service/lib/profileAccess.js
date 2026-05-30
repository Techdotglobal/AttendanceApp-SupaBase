const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const isHrManager = (requester) =>
  requester?.role === ROLES.MANAGER && String(requester.department || '').toLowerCase() === 'hr';

const isSuperAdmin = (requester) => requester?.role === ROLES.SUPER_ADMIN;

/**
 * Super admin and HR managers may edit any non–super_admin profile in the tenant.
 * Other managers are limited to their own department.
 */
const assertCanManageUser = (requester, targetUser) => {
  if (!requester?.role || !targetUser) {
    return { ok: false, status: 403, error: 'Permission denied' };
  }
  if (targetUser.role === ROLES.SUPER_ADMIN && !isSuperAdmin(requester)) {
    return { ok: false, status: 403, error: 'Cannot modify super admin accounts' };
  }
  if (isSuperAdmin(requester) || isHrManager(requester)) {
    return { ok: true };
  }
  if (requester.role === ROLES.MANAGER) {
    if (targetUser.department !== requester.department) {
      return {
        ok: false,
        status: 403,
        error: 'Managers can only update users in their department',
      };
    }
    return { ok: true };
  }
  return { ok: false, status: 403, error: 'Permission denied' };
};

const canEditAnyProfile = (requester) => isSuperAdmin(requester) || isHrManager(requester);

module.exports = {
  ROLES,
  isHrManager,
  isSuperAdmin,
  assertCanManageUser,
  canEditAnyProfile,
};
