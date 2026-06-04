const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const isSuperAdmin = (requester) => requester?.role === ROLES.SUPER_ADMIN;

/**
 * Super admins and permission-elevated managers may edit any non-super_admin
 * profile in the tenant. Other managers are limited to their own department.
 */
const assertCanManageUser = (requester, targetUser, options = {}) => {
  const tenantWide = Boolean(options.tenantWide);
  if (!requester?.role || !targetUser) {
    return { ok: false, status: 403, error: 'Permission denied' };
  }
  if (targetUser.role === ROLES.SUPER_ADMIN && !isSuperAdmin(requester)) {
    return { ok: false, status: 403, error: 'Cannot modify super admin accounts' };
  }
  if (isSuperAdmin(requester) || tenantWide) {
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

const canEditAnyProfile = (requester, options = {}) =>
  isSuperAdmin(requester) || Boolean(options.tenantWide);

module.exports = {
  ROLES,
  isSuperAdmin,
  assertCanManageUser,
  canEditAnyProfile,
};
