const express = require('express');
const { supabase } = require('../config/supabase');
const { getTenantCompanyId, fetchCompanyUserUids } = require('../lib/tenantScope');
const { normalizeDepartmentName, normalizePosition, toLookupKey } = require('../lib/orgNormalize');
const { normalizedUsernameKey } = require('../lib/loginNormalize');
const { updateUsernameForUid } = require('../lib/usernameUpdate');
const { syncAuthMetadataForUid, syncAuthMetadataAndInvalidateSessions } = require('../lib/authMetadata');
const { ensureDepartmentForCompany } = require('../lib/departmentService');
const {
  assertCanManageUser,
  canEditAnyProfile,
} = require('../lib/profileAccess');
const {
  MANAGER_PERMISSION_GROUPS,
  ALL_MANAGER_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  getManagerPermissions,
  getEffectiveGrants,
  upsertPermissionGrant,
  writeAuthorizationAudit,
  canDelegatePermission,
  hasPermission,
  PERMISSION_DEFINITIONS,
  hasAnyPermission,
  getUserDepartmentIds,
  resolveScopedUserUids,
  requirePermission,
  rejectSelfAdministrativeChange,
  writeAuditLog,
} = require('../lib/permissions');
const { enrichLeaveRequestsWithEmployees } = require('../lib/leaveEmployeeResolve');
const { countBusinessDays } = require('../lib/payrollEngine');
const {
  initializeApprovalSteps,
  getApprovalProgress,
  processApprovalStep,
  canUserActOnStep,
  mapLeaveTypeToRequestType,
} = require('../lib/approvalEngine');
const { markAttendanceSummaryDirty } = require('../lib/attendanceFinalizer');

const router = express.Router();

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const getRequesterDepartment = async (requester, companyId) => {
  if (!requester?.department || !companyId) return null;
  const normalized = normalizeDepartmentName(requester.department);
  const lookupKey = toLookupKey(normalized || requester.department);
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .eq('normalized_name', lookupKey)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

// Identity is resolved centrally via lib/resolveRequester (JWT / gateway-vouched
// X-User-Context). Do not read x-user-context directly in this file.

const requireSuperAdmin = (requester, res) => {
  if (requester.role !== ROLES.SUPER_ADMIN) {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return false;
  }
  return true;
};

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
const DUPLICATE_DEPARTMENT_ERROR =
  'A department with this name already exists.\nDepartment names are case-insensitive.';

const hasTenantWidePeopleAccess = async (requester) =>
  requester?.role === ROLES.SUPER_ADMIN ||
  (requester?.role &&
    requester.role !== ROLES.SUPER_ADMIN &&
    (await hasAnyPermission(supabase, requester, TENANT_WIDE_PEOPLE_PERMISSIONS)));

const requireAdminPermission = async (requester, permissionKey, res, target = null) =>
  requirePermission(supabase, requester, permissionKey, res, target);

const requireAnyAdminPermission = async (requester, permissionKeys, res) => {
  const ok = await hasAnyPermission(supabase, requester, permissionKeys);
  if (!ok) {
    res.status(403).json({ success: false, error: 'Insufficient permissions' });
    return false;
  }
  return true;
};

const ATTENDANCE_READ_PERMISSIONS = ['view_attendance', 'manual_attendance'];

/**
 * Resolves tenant from X-User-Context (company_id) or users row by uid.
 * @returns {Promise<{ requester: object, companyId: string }|null>}
 */
const { resolveRequester } = require('../lib/resolveRequester');

const withTenantContext = async (req, res) => {
  const requester = await resolveRequester(req);
  if (!requester || !requester.uid || !requester.role) {
    res.status(401).json({ success: false, error: 'Authentication required. Sign in again.' });
    return null;
  }
  const companyId = await getTenantCompanyId(supabase, requester);
  if (!companyId) {
    res.status(403).json({
      success: false,
      error: 'Missing tenant scope (company_id). Re-login or update the client.',
    });
    return null;
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log('[tenant admin]', { path: req.path, companyId, uid: requester.uid, role: requester.role });
  }
  requester.tenantWidePeopleAccess = await hasTenantWidePeopleAccess(requester);
  return { requester, companyId };
};

async function replaceDepartmentAssignmentsAtomic({ companyId, targetUid, departmentIds, primaryDepartmentId, actorUid }) {
  const { data, error } = await supabase.rpc('replace_user_department_assignments', {
    p_company_id: companyId,
    p_user_uid: targetUid,
    p_department_ids: departmentIds,
    p_primary_department_id: primaryDepartmentId || null,
    p_actor_uid: actorUid || null,
  });
  if (error) throw error;
  return data;
}

const LEAVE_FALLBACK = { annual: 20, sick: 10, casual: 5 };

const getCompanyLeaveDefaults = async (companyId) => {
  const { data } = await supabase
    .from('leave_settings')
    .select('default_annual_leaves, default_sick_leaves, default_casual_leaves')
    .eq('company_id', companyId)
    .maybeSingle();
  return {
    annual_leaves: data?.default_annual_leaves ?? LEAVE_FALLBACK.annual,
    sick_leaves: data?.default_sick_leaves ?? LEAVE_FALLBACK.sick,
    casual_leaves: data?.default_casual_leaves ?? LEAVE_FALLBACK.casual,
  };
};

const resolveLeaveBalanceForUser = async (uid, companyId) => {
  const defaults = await getCompanyLeaveDefaults(companyId);
  const { data: effective, error: effectiveError } = await supabase.rpc('get_effective_leave_balance', {
    p_user_uid: uid,
  });
  if (!effectiveError && effective) {
    return {
      annual_leaves: Number(effective.annualLeaves ?? defaults.annual_leaves),
      sick_leaves: Number(effective.sickLeaves ?? defaults.sick_leaves),
      casual_leaves: Number(effective.casualLeaves ?? defaults.casual_leaves),
      used_annual_leaves: Number(effective.usedAnnualLeaves || 0),
      used_sick_leaves: Number(effective.usedSickLeaves || 0),
      used_casual_leaves: Number(effective.usedCasualLeaves || 0),
      is_custom: Boolean(effective.isCustom),
    };
  }
  const { data } = await supabase
    .from('leave_balances')
    .select('annual_leaves, sick_leaves, casual_leaves, is_custom')
    .eq('user_uid', uid)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) {
    return { ...defaults, is_custom: false };
  }
  return {
    annual_leaves: data.annual_leaves,
    sick_leaves: data.sick_leaves,
    casual_leaves: data.casual_leaves,
    is_custom: Boolean(data.is_custom),
  };
};

const LEAVE_TYPE_BALANCE_FIELD = {
  annual: 'annual_leaves',
  sick: 'sick_leaves',
  casual: 'casual_leaves',
};

/**
 * Allocated balance minus already-approved days of that type. Mirrors the
 * mobile self-service calculation (apps/mobile/utils/leaveManagement.js
 * calculateRemainingLeaves), just computed server-side since the admin
 * leave-creation endpoint has no equivalent client to do it in.
 */
const resolveRemainingLeaveForEmployee = async (employeeUid, companyId, leaveType) => {
  const field = LEAVE_TYPE_BALANCE_FIELD[leaveType];
  const balance = await resolveLeaveBalanceForUser(employeeUid, companyId);
  const allocated = Number(balance[field]) || 0;
  const usedField = `used_${leaveType}_leaves`;
  if (Object.prototype.hasOwnProperty.call(balance, usedField)) {
    const used = Number(balance[usedField]);
    if (Number.isFinite(used)) return { allocated, used, remaining: allocated - used };
  }
  const { data: approved } = await supabase
    .from('leave_requests')
    .select('days')
    .eq('employee_uid', employeeUid)
    .eq('company_id', companyId)
    .eq('leave_type', leaveType)
    .eq('status', 'approved');
  const used = (approved || []).reduce((sum, row) => sum + (Number(row.days) || 0), 0);
  return { allocated, used, remaining: allocated - used };
};

const getUsersBaseQuery = (requester, companyId) => {
  let query = supabase
    .from('users')
    .select('uid, username, email, report_email, name, role, department, department_id, organization_role_id, authorization_version, position, work_mode, hire_date, is_active, created_at, company_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return query;
};

router.get('/analytics', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'view_analytics', res))) return;

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sinceIso = sevenDaysAgo.toISOString();
    const analyticsUserUids = await resolveScopedUserUids(supabase, requester, companyId, 'view_analytics');

    let usersQuery = supabase
      .from('users')
      .select('uid, department, department_id, is_active')
      .eq('company_id', companyId);
    if (analyticsUserUids) usersQuery = usersQuery.in('uid', analyticsUserUids.length ? analyticsUserUids : ['00000000-0000-0000-0000-000000000000']);

    let departmentsQuery = supabase
      .from('departments')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name', { ascending: true });
    if (analyticsUserUids) {
      const { data: scopedUsers } = await supabase.from('users').select('department_id').eq('company_id', companyId).in('uid', analyticsUserUids.length ? analyticsUserUids : ['00000000-0000-0000-0000-000000000000']);
      const departmentIds = [...new Set((scopedUsers || []).map((row) => row.department_id).filter(Boolean))];
      departmentsQuery = departmentsQuery.in('id', departmentIds.length ? departmentIds : ['00000000-0000-0000-0000-000000000000']);
    }

    let attendance7dQuery = supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('timestamp', sinceIso);
    if (analyticsUserUids) {
      attendance7dQuery = attendance7dQuery.in(
        'user_uid',
        analyticsUserUids.length ? analyticsUserUids : ['00000000-0000-0000-0000-000000000000']
      );
    }

    const [{ data: users, error: usersError }, { data: departments, error: deptError }, { count: attendance7d, error: attError }] =
      await Promise.all([usersQuery, departmentsQuery, attendance7dQuery]);
    if (usersError) throw usersError;
    if (deptError) throw deptError;
    if (attError) throw attError;

    const userList = users || [];
    const activeUsers = userList.filter((u) => u.is_active).length;
    const departmentIdByName = new Map();
    const distributionById = new Map();

    for (const dept of departments || []) {
      departmentIdByName.set(toLookupKey(dept.name), dept.id);
      distributionById.set(dept.id, {
        id: dept.id,
        name: dept.name,
        employeeCount: 0,
        activeCount: 0,
      });
    }

    let unassignedUsers = 0;
    for (const user of userList) {
      let deptId = user.department_id || null;
      if (!deptId && user.department) {
        deptId = departmentIdByName.get(toLookupKey(user.department)) || null;
      }
      if (!deptId || !distributionById.has(deptId)) {
        unassignedUsers += 1;
        continue;
      }
      const bucket = distributionById.get(deptId);
      bucket.employeeCount += 1;
      if (user.is_active) bucket.activeCount += 1;
    }

    const departmentDistribution = Array.from(distributionById.values())
      .filter((d) => d.employeeCount > 0)
      .sort((a, b) => b.employeeCount - a.employeeCount);

    if (unassignedUsers > 0) {
      departmentDistribution.push({
        id: 'unassigned',
        name: 'Unassigned',
        employeeCount: unassignedUsers,
        activeCount: unassignedUsers,
      });
    }

    const attendanceLast7Days = attendance7d || 0;
    const avgAttendancePerActiveUser7d =
      activeUsers > 0 ? Math.round((attendanceLast7Days / activeUsers) * 100) / 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        departmentDistribution,
        insights: {
          totalUsers: userList.length,
          activeUsers,
          attendanceLast7Days,
          avgAttendancePerActiveUser7d,
          trackedDepartments: (departments || []).length,
          unassignedUsers,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch analytics' });
  }
});

router.get('/dashboard/stats', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'view_hr_dashboard', res))) return;
  try {
    const dashboardUserUids = await resolveScopedUserUids(supabase, requester, companyId, 'view_hr_dashboard');
    let usersQuery = supabase
      .from('users')
      .select('uid, department, department_id, is_active', { count: 'exact' })
      .eq('company_id', companyId);
    if (dashboardUserUids) usersQuery = usersQuery.in('uid', dashboardUserUids.length ? dashboardUserUids : ['00000000-0000-0000-0000-000000000000']);

    const departmentsQuery = supabase
      .from('departments')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId);

    let attendanceQuery = supabase
      .from('attendance_records')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId);
    if (dashboardUserUids) {
      attendanceQuery = supabase
        .from('attendance_records')
        .select('id', { count: 'exact' })
        .eq('company_id', companyId)
        .in('user_uid', dashboardUserUids.length ? dashboardUserUids : ['00000000-0000-0000-0000-000000000000']);
    }

    let leaveQuery = supabase
      .from('leave_requests')
      .select('id, status', { count: 'exact' })
      .eq('company_id', companyId);
    if (dashboardUserUids) {
      leaveQuery = supabase
        .from('leave_requests')
        .select('id, status', { count: 'exact' })
        .eq('company_id', companyId)
        .in('employee_uid', dashboardUserUids.length ? dashboardUserUids : ['00000000-0000-0000-0000-000000000000']);
    }

    const [{ data: users }, { count: departments }, { count: attendance }, { data: leaves }] = await Promise.all([
      usersQuery,
      departmentsQuery,
      attendanceQuery,
      leaveQuery,
    ]);

    const activeUsers = (users || []).filter((u) => u.is_active).length;
    const pendingLeaves = (leaves || []).filter((l) => l.status === 'pending').length;

    res.status(200).json({
      success: true,
      data: {
        totalEmployees: users?.length || 0,
        totalDepartments: departments || 0,
        activeUsers,
        attendanceRecords: attendance || 0,
        pendingLeaves,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch dashboard stats' });
  }
});

router.get('/users', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const canViewUsers = await hasPermission(supabase, requester, 'view_employees');
  const canAssignUsers = await hasPermission(supabase, requester, 'assign_user_permissions');
  if (!canViewUsers && !canAssignUsers && requester.role !== ROLES.SUPER_ADMIN) {
    res.status(403).json({ success: false, error: 'Permission required: view_employees or assign_user_permissions' });
    return;
  }
  try {
    const { data, error } = await getUsersBaseQuery(requester, companyId);
    if (error) throw error;
    let visible = data || [];
    if (requester.role !== ROLES.SUPER_ADMIN && !requester.tenantWidePeopleAccess) {
      visible = [];
      for (const target of data || []) {
        const targetScope = { companyId, targetUid: target.uid, userUid: target.uid, departmentId: target.department_id, departmentIds: await getUserDepartmentIds(supabase, target.uid, target) };
        if ((canViewUsers && await hasPermission(supabase, { ...requester, company_id: companyId }, 'view_employees', targetScope)) ||
            (canAssignUsers && await hasPermission(supabase, { ...requester, company_id: companyId }, 'assign_user_permissions', targetScope))) visible.push(target);
      }
    }
    res.status(200).json({ success: true, data: visible });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch users' });
  }
});

router.get('/users/:uid', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const { uid } = req.params;
  if (!(await requireAdminPermission(requester, 'view_employees', res))) return;
  try {
    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('uid, username, email, report_email, name, role, department, department_id, organization_role_id, authorization_version, position, work_mode, hire_date, is_active, created_at, updated_at, company_id')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .single();
    if (targetError || !targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (role !== undefined && !Object.values(ROLES).includes(String(role).toLowerCase())) {
      return res.status(400).json({ success: false, error: 'Invalid system role' });
    }
    const access = assertCanManageUser(requester, targetUser, {
      tenantWide: requester.tenantWidePeopleAccess,
      scopedAllowed: requester.role === ROLES.SUPER_ADMIN || await hasPermission(supabase, { ...requester, company_id: companyId }, 'view_employees', {
        companyId, targetUid: uid, userUid: uid, departmentId: targetUser.department_id,
      }),
    });
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }
    const leave_balance = await resolveLeaveBalanceForUser(uid, companyId);
    res.status(200).json({
      success: true,
      data: { ...targetUser, leave_balance },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch user' });
  }
});

router.patch('/users/:uid', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const { uid } = req.params;
  const body = req.body || {};
  const {
    role,
    department,
    work_mode,
    position,
    hire_date,
    is_active,
    username,
    email,
    report_email,
    name,
    annual_leaves,
    sick_leaves,
    casual_leaves,
    organization_role_id,
    password,
  } = body;

  if (rejectSelfAdministrativeChange(requester, uid, res)) return;

  if (password !== undefined) {
    return res.status(403).json({
      success: false,
      error: 'Admins cannot reset passwords. Users must change their password in the mobile app.',
    });
  }

  try {
    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('uid, username, email, role, department, department_id, organization_role_id, company_id, is_active')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .single();
    if (targetError || !targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const access = assertCanManageUser(requester, targetUser, {
      tenantWide: requester.tenantWidePeopleAccess,
      scopedAllowed: requester.role === ROLES.SUPER_ADMIN || await hasPermission(supabase, { ...requester, company_id: companyId }, 'edit_user', {
        companyId, targetUid: uid, userUid: uid, departmentId: targetUser.department_id,
      }),
    });
    if (!access.ok) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const profileFieldsTouched =
      username !== undefined ||
      email !== undefined ||
      report_email !== undefined ||
      name !== undefined ||
      department !== undefined ||
      position !== undefined ||
      hire_date !== undefined ||
      work_mode !== undefined ||
      organization_role_id !== undefined ||
      annual_leaves !== undefined ||
      sick_leaves !== undefined ||
      casual_leaves !== undefined;

    if (organization_role_id !== undefined && organization_role_id !== null) {
      const { data: organizationRole } = await supabase
        .from('organization_roles')
        .select('id')
        .eq('id', organization_role_id)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .maybeSingle();
      if (!organizationRole) return res.status(400).json({ success: false, error: 'Invalid organizational role' });
    }

    const VALID_WORK_MODES = ['in_office', 'semi_remote', 'fully_remote'];
    if (work_mode !== undefined && !VALID_WORK_MODES.includes(work_mode)) {
      return res.status(400).json({
        success: false,
        error: `Invalid work_mode. Must be one of: ${VALID_WORK_MODES.join(', ')}`,
      });
    }

    if (profileFieldsTouched && !canEditAnyProfile(requester, {
      tenantWide: requester.tenantWidePeopleAccess,
      scopedAllowed: await hasPermission(supabase, { ...requester, company_id: companyId }, 'edit_user', {
        companyId, targetUid: uid, userUid: uid, departmentId: targetUser.department_id,
      }),
    })) {
      return res.status(403).json({
        success: false,
        error: 'Permission denied: edit_user with tenant-wide people access is required',
      });
    }
    const targetScope = { companyId, targetUid: uid, userUid: uid, departmentId: targetUser.department_id };
    if (profileFieldsTouched && !(await requireAdminPermission(requester, 'edit_user', res, targetScope))) return;
    if (role !== undefined && role !== targetUser.role && !(await requireAdminPermission(requester, 'change_user_role', res, targetScope))) return;
    if (is_active !== undefined && Boolean(is_active) !== Boolean(targetUser.is_active)) {
      const key = is_active ? 'activate_user' : 'deactivate_user';
      if (!(await requireAdminPermission(requester, key, res, targetScope))) return;
    }
    const leaveTouched =
      annual_leaves !== undefined || sick_leaves !== undefined || casual_leaves !== undefined;
    if (leaveTouched && !(await requireAdminPermission(requester, 'edit_leave_balance', res, targetScope))) return;
    if (targetUser.role === ROLES.SUPER_ADMIN && role && role !== targetUser.role) {
      return res.status(403).json({ success: false, error: 'Super admin role cannot be changed here' });
    }
    if (role && String(role).toLowerCase() === 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Assigning super_admin is only supported via company onboarding',
      });
    }

    const authCredentialUpdates = {};
    const updates = { updated_at: new Date().toISOString() };
    let departmentReplacement = null;

    if (username !== undefined) {
      const usernameResult = await updateUsernameForUid(supabase, companyId, uid, username);
      if (!usernameResult.ok) {
        return res.status(usernameResult.status).json({
          success: false,
          error: usernameResult.error,
        });
      }
      updates.username = usernameResult.username;
      updates.normalized_username = usernameResult.normalized_username;
    }

    if (email !== undefined) {
      const trimmedEmail = String(email).trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
      }
      authCredentialUpdates.email = trimmedEmail;
      authCredentialUpdates.email_confirm = true;
      updates.email = trimmedEmail;
    }

    if (Object.keys(authCredentialUpdates).length > 0) {
      const { error: authError } = await supabase.auth.admin.updateUserById(uid, authCredentialUpdates);
      if (authError) {
        return res.status(500).json({
          success: false,
          error: authError.message || 'Failed to update credentials in Auth',
        });
      }
    }

    if (name !== undefined) {
      updates.name = String(name).trim() || null;
    }

    if (report_email !== undefined) {
      if (report_email === null || String(report_email).trim() === '') {
        updates.report_email = null;
      } else {
        const trimmed = String(report_email).trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmed)) {
          return res.status(400).json({ success: false, error: 'Invalid report_email format' });
        }
        updates.report_email = trimmed;
      }
    }

    if (role !== undefined) updates.role = role;

    if (department !== undefined) {
      const trimmedDept = department != null ? String(department).trim() : '';
      if (!trimmedDept) {
        departmentReplacement = { departmentIds: [], primaryDepartmentId: null };
      } else {
        const ensured = await ensureDepartmentForCompany(companyId, trimmedDept);
        departmentReplacement = {
          departmentIds: ensured?.id ? [String(ensured.id)] : [],
          primaryDepartmentId: ensured?.id ? String(ensured.id) : null,
        };
      }
    }

    if (work_mode !== undefined) updates.work_mode = work_mode;

    if (position !== undefined) {
      const trimmedPosition = position != null ? String(position).trim() : '';
      updates.position = trimmedPosition ? normalizePosition(trimmedPosition) : null;
    }

    if (hire_date !== undefined) {
      updates.hire_date = hire_date || null;
    }

    if (is_active !== undefined) updates.is_active = is_active;
    if (organization_role_id !== undefined) updates.organization_role_id = organization_role_id || null;

    if (departmentReplacement
        && String(departmentReplacement.primaryDepartmentId || '') !== String(targetUser.department_id || '')) {
      if (requester.role !== ROLES.SUPER_ADMIN) {
        const departmentsToAuthorize = departmentReplacement.departmentIds.length
          ? departmentReplacement.departmentIds
          : [targetUser.department_id].filter(Boolean);
        if (!departmentsToAuthorize.length) {
          return res.status(403).json({ success: false, error: 'You cannot clear this user\'s department assignment' });
        }
        for (const departmentId of departmentsToAuthorize) {
          if (!(await hasPermission(supabase, { ...requester, company_id: companyId }, 'assign_user_department', {
            companyId, targetUid: uid, userUid: uid, departmentId,
          }))) return res.status(403).json({ success: false, error: 'Permission required: assign_user_department' });
        }
      }
      await replaceDepartmentAssignmentsAtomic({
        companyId,
        targetUid: uid,
        departmentIds: departmentReplacement.departmentIds,
        primaryDepartmentId: departmentReplacement.primaryDepartmentId,
        actorUid: requester.uid,
      });
    }

    const profileRowTouched = Object.keys(updates).length > 1;
    if (profileRowTouched) {
      const { error: userUpdateError } = await supabase
        .from('users')
        .update(updates)
        .eq('uid', uid)
        .eq('company_id', companyId);
      if (userUpdateError) throw userUpdateError;
    }

    const authNeedsSync =
      profileRowTouched || (role !== undefined && role !== targetUser.role);
    if (authNeedsSync) {
      const metaSync = await syncAuthMetadataAndInvalidateSessions(supabase, uid);
      if (!metaSync.ok) {
        return res.status(500).json({
          success: false,
          error: metaSync.error || 'Profile saved but failed to sync authentication',
        });
      }
    }

    if (leaveTouched) {
      const parseLeave = (v, fallback) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return fallback;
        return Math.floor(n);
      };
      const current = await resolveLeaveBalanceForUser(uid, companyId);
      const annual = parseLeave(annual_leaves, current.annual_leaves);
      const sick = parseLeave(sick_leaves, current.sick_leaves);
      const casual = parseLeave(casual_leaves, current.casual_leaves);
      const { error: leaveError } = await supabase.from('leave_balances').upsert(
        {
          user_uid: uid,
          company_id: companyId,
          annual_leaves: annual,
          sick_leaves: sick,
          casual_leaves: casual,
          is_custom: true,
        },
        { onConflict: 'user_uid' }
      );
      if (leaveError) throw leaveError;
    }

    if (is_active !== undefined && Boolean(is_active) !== Boolean(targetUser.is_active)) {
      await writeAuditLog(supabase, {
        actorUid: requester.uid,
        targetUid: uid,
        action: Boolean(is_active) ? 'user_activated' : 'user_deactivated',
      });
    }
    if (role !== undefined && role !== targetUser.role) {
      await writeAuditLog(supabase, {
        actorUid: requester.uid,
        targetUid: uid,
        action: 'role_changed',
      });
    }
    if (organization_role_id !== undefined && String(organization_role_id || '') !== String(targetUser.organization_role_id || '')) {
      await writeAuthorizationAudit(supabase, {
        companyId,
        actorUid: requester.uid,
        targetUid: uid,
        action: 'organization_role_assigned',
        beforeState: { organization_role_id: targetUser.organization_role_id || null },
        afterState: { organization_role_id: organization_role_id || null },
      });
    }

    const leave_balance = await resolveLeaveBalanceForUser(uid, companyId);
    const { data: refreshed } = await supabase
      .from('users')
      .select('uid, username, email, report_email, name, role, department, department_id, organization_role_id, position, work_mode, hire_date, is_active, updated_at')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .single();

    res.status(200).json({
      success: true,
      data: refreshed ? { ...refreshed, leave_balance } : { leave_balance },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update user' });
  }
});

router.get('/departments', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
      const managerDept = await getRequesterDepartment(requester, companyId);
      const { data } = managerDept
        ? await supabase.from('departments').select('*').eq('id', managerDept.id).eq('company_id', companyId)
        : { data: [] };
      return res.status(200).json({ success: true, data: data || [] });
    }
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch departments' });
  }
});

router.post('/departments', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  if (!(await requireAdminPermission(ctx.requester, 'manage_departments', res))) return;
  const { companyId } = ctx;
  try {
    const { name } = req.body;
    const normalizedName = normalizeDepartmentName(name);
    if (!normalizedName) return res.status(400).json({ success: false, error: 'Department name is required' });
    const lookupKey = toLookupKey(name);
    const { data: existing, error: existingError } = await supabase
      .from('departments')
      .select('id')
      .eq('company_id', companyId)
      .eq('normalized_name', lookupKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return res.status(409).json({ success: false, error: DUPLICATE_DEPARTMENT_ERROR });
    }
    const { data, error } = await supabase
      .from('departments')
      .insert({
        name: normalizedName,
        normalized_name: lookupKey,
        company_id: companyId,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: DUPLICATE_DEPARTMENT_ERROR });
      }
      throw error;
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create department' });
  }
});

router.patch('/departments/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  if (!(await requireAdminPermission(ctx.requester, 'manage_departments', res))) return;
  const { companyId } = ctx;
  try {
    const { id } = req.params;
    const { name } = req.body;
    const normalizedName = normalizeDepartmentName(name);
    if (!normalizedName) return res.status(400).json({ success: false, error: 'Department name is required' });

    const { data: currentDept, error: deptLookupError } = await supabase
      .from('departments')
      .select('id, name')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (deptLookupError || !currentDept) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    const oldName = currentDept.name;
    const lookupKey = toLookupKey(name);
    const { error: deptUpdateError } = await supabase
      .from('departments')
      .update({ name: normalizedName, normalized_name: lookupKey })
      .eq('id', id)
      .eq('company_id', companyId);
    if (deptUpdateError) {
      if (deptUpdateError.code === '23505') {
        return res.status(409).json({ success: false, error: DUPLICATE_DEPARTMENT_ERROR });
      }
      throw deptUpdateError;
    }

    // Backward compatibility: keep legacy users.department in sync (tenant-scoped).
    const { error: usersUpdateError } = await supabase
      .from('users')
      .update({
        department: normalizedName,
        department_id: id,
        updated_at: new Date().toISOString(),
      })
      .eq('department_id', id)
      .eq('company_id', companyId);
    if (usersUpdateError) throw usersUpdateError;

    const tenantUids = await fetchCompanyUserUids(supabase, companyId);
    if (tenantUids.length > 0) {
      await supabase
        .from('leave_requests')
        .update({ category: normalizedName.toLowerCase() })
        .eq('category', oldName.toLowerCase())
        .in('employee_uid', tenantUids);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to rename department' });
  }
});

router.delete('/departments/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  if (!(await requireAdminPermission(ctx.requester, 'manage_departments', res))) return;
  const { companyId } = ctx;
  try {
    const { id } = req.params;
    const { count: activeUsersCount, error: usersCountError } = await supabase
      .from('users')
      .select('uid', { count: 'exact', head: true })
      .eq('department_id', id)
      .eq('company_id', companyId)
      .eq('is_active', true);
    if (usersCountError) throw usersCountError;
    if ((activeUsersCount || 0) > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete department with active users',
      });
    }
    const { error } = await supabase.from('departments').delete().eq('id', id).eq('company_id', companyId);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to delete department' });
  }
});

router.get('/departments/overview', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;

  try {
    let departmentsQuery = supabase
      .from('departments')
      .select('id, name, created_at')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (requester.role === ROLES.MANAGER) {
      const managerDept = await getRequesterDepartment(requester, companyId);
      if (!managerDept) return res.status(200).json({ success: true, data: [] });
      departmentsQuery = departmentsQuery.eq('id', managerDept.id);
    }

    const { data: departments, error: departmentsError } = await departmentsQuery;
    if (departmentsError) throw departmentsError;

    // Primary path: centralized departments table. During rollout, some users
    // may still have department text but no department_id, so map by ID first
    // and normalized department name second.
    if ((departments || []).length > 0) {
      const byDepartment = new Map();
      const departmentIdByName = new Map();
      for (const dept of departments) {
        byDepartment.set(dept.id, {
          id: dept.id,
          name: dept.name,
          created_at: dept.created_at,
          employeeCount: 0,
          manager: null,
          employees: [],
        });
        departmentIdByName.set(toLookupKey(dept.name), dept.id);
      }

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('uid, name, username, role, position, is_active, department_id, department')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (usersError) throw usersError;

      for (const user of users || []) {
        const deptId = user.department_id || departmentIdByName.get(toLookupKey(user.department));
        if (!deptId || !byDepartment.has(deptId)) continue;
        const dept = byDepartment.get(deptId);
        if (user.is_active) dept.employeeCount += 1;
        if (user.role === ROLES.MANAGER && !dept.manager) {
          dept.manager = {
            uid: user.uid,
            name: user.name,
            username: user.username,
            position: user.position,
          };
        }
        dept.employees.push({
          uid: user.uid,
          name: user.name,
          username: user.username,
          role: user.role,
          position: user.position,
          is_active: user.is_active,
        });
      }

      return res.status(200).json({ success: true, data: Array.from(byDepartment.values()) });
    }

    // Fallback path: no centralized departments yet; derive from users.department.
    let usersFallbackQuery = supabase
      .from('users')
      .select('uid, name, username, role, position, is_active, department')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (requester.role === ROLES.MANAGER) {
      const normalizedManagerDepartment = normalizeDepartmentName(requester.department);
      usersFallbackQuery = usersFallbackQuery.eq('department', normalizedManagerDepartment || requester.department);
    } else {
      usersFallbackQuery = usersFallbackQuery.not('department', 'is', null);
    }

    const { data: fallbackUsers, error: fallbackUsersError } = await usersFallbackQuery;
    if (fallbackUsersError) throw fallbackUsersError;

    const fallbackMap = new Map();
    for (const user of fallbackUsers || []) {
      const normalizedDept = normalizeDepartmentName(user.department);
      if (!normalizedDept) continue;
      if (!fallbackMap.has(normalizedDept)) {
        fallbackMap.set(normalizedDept, {
          id: `legacy-${normalizedDept.toLowerCase().replace(/\s+/g, '-')}`,
          name: normalizedDept,
          created_at: null,
          employeeCount: 0,
          manager: null,
          employees: [],
        });
      }
      const dept = fallbackMap.get(normalizedDept);
      if (user.is_active) dept.employeeCount += 1;
      if (user.role === ROLES.MANAGER && !dept.manager) {
        dept.manager = {
          uid: user.uid,
          name: user.name,
          username: user.username,
          position: user.position,
        };
      }
      dept.employees.push({
        uid: user.uid,
        name: user.name,
        username: user.username,
        role: user.role,
        position: user.position,
        is_active: user.is_active,
      });
    }

    return res.status(200).json({
      success: true,
      data: Array.from(fallbackMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch departments overview' });
  }
});

const {
  SITE_RADIUS_MAX,
  validateSiteGeometry,
  isUniqueViolation,
  siteNameKey,
} = require('../lib/siteValidation');

/** Resolve a department UUID from a (possibly display) name within a company. */
async function getDepartmentIdByName(name, companyId) {
  const raw = String(name || '').trim();
  if (!raw || !companyId) return null;
  const key = toLookupKey(normalizeDepartmentName(raw) || raw);
  const { data } = await supabase
    .from('departments')
    .select('id, name, normalized_name')
    .eq('company_id', companyId);
  const row = (data || []).find(
    (d) =>
      toLookupKey(d.normalized_name) === key ||
      toLookupKey(normalizeDepartmentName(d.name) || d.name) === key
  );
  return row?.id ? String(row.id) : null;
}

/** Caller's authoritative department UUID (by id, then normalized name). */
async function resolveRequesterDepartmentId(requester, companyId) {
  if (requester?.department_id) return String(requester.department_id);
  const dept = await getRequesterDepartment(requester, companyId);
  return dept?.id ? String(dept.id) : null;
}

/** Case-insensitive name clash within a single (company, department). */
async function siteNameClashInDepartment(companyId, departmentId, name, excludeId = null) {
  const key = siteNameKey(name);
  if (!key || !departmentId) return false;
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('department_id', departmentId);
  return (data || []).some(
    (r) => String(r.id) !== String(excludeId) && siteNameKey(r.name) === key
  );
}

/**
 * Load a site the caller is allowed to administer, or send the error response.
 * @returns {Promise<object|null>} the site row, or null (response already sent)
 */
async function loadManageableSite(siteId, requester, companyId, res) {
  const { data: site } = await supabase
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!site) {
    res.status(404).json({ success: false, error: 'Site not found in your company' });
    return null;
  }
  if (requester.role === ROLES.MANAGER) {
    const managerDeptId = await resolveRequesterDepartmentId(requester, companyId);
    if (!managerDeptId || String(site.department_id) !== managerDeptId) {
      res.status(403).json({
        success: false,
        error: 'Managers can only manage sites in their own department',
      });
      return null;
    }
  }
  return site;
}

router.get('/sites', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  try {
    let query = supabase
      .from('sites')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (requester.role === ROLES.MANAGER) {
      const managerDeptId = await resolveRequesterDepartmentId(requester, companyId);
      if (!managerDeptId) return res.status(200).json({ success: true, data: [] });
      query = query.eq('department_id', managerDeptId);
    } else {
      const { data: depts } = await supabase.from('departments').select('id').eq('company_id', companyId);
      const ids = (depts || []).map((d) => d.id).filter(Boolean);
      if (ids.length === 0) return res.status(200).json({ success: true, data: [] });
      query = query.in('department_id', ids);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch sites' });
  }
});

router.post('/sites', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Location name is required' });
    }

    // Resolve + authorize the target department.
    let departmentId = body.department_id != null ? String(body.department_id) : null;
    if (requester.role === ROLES.MANAGER) {
      const managerDeptId = await resolveRequesterDepartmentId(requester, companyId);
      if (!managerDeptId) {
        return res.status(400).json({ success: false, error: 'Your account is not linked to a department' });
      }
      if (departmentId && departmentId !== managerDeptId) {
        return res
          .status(403)
          .json({ success: false, error: 'Managers can only create sites in their department' });
      }
      departmentId = managerDeptId;
    }
    if (!departmentId) {
      return res.status(400).json({ success: false, error: 'Department is required' });
    }
    const { data: dept } = await supabase
      .from('departments')
      .select('id')
      .eq('id', departmentId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!dept) {
      return res.status(400).json({ success: false, error: 'Department not in this tenant' });
    }

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const radius = Number(body.radius);
    const geomError = validateSiteGeometry({ latitude, longitude, radius });
    if (geomError) return res.status(400).json({ success: false, error: geomError });

    if (await siteNameClashInDepartment(companyId, departmentId, name)) {
      return res.status(409).json({
        success: false,
        error: 'An active location with this name already exists in this department',
      });
    }

    const address = body.address != null ? String(body.address).trim().slice(0, 500) || null : null;

    const { data, error } = await supabase
      .from('sites')
      .insert({
        company_id: companyId,
        department_id: departmentId,
        name,
        latitude,
        longitude,
        radius: Math.round(radius),
        address,
      })
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          success: false,
          error: 'An active location with this name already exists in this department',
        });
      }
      throw error;
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create site' });
  }
});

router.patch('/sites/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  try {
    const site = await loadManageableSite(req.params.id, requester, companyId, res);
    if (!site) return;

    const body = req.body || {};
    const patch = {};

    // Department move: super_admin only, target must be in the company.
    let targetDepartmentId = String(site.department_id);
    if (body.department_id != null && String(body.department_id) !== String(site.department_id)) {
      if (requester.role === ROLES.MANAGER) {
        return res
          .status(403)
          .json({ success: false, error: 'Managers cannot move a site to another department' });
      }
      const { data: dept } = await supabase
        .from('departments')
        .select('id')
        .eq('id', body.department_id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (!dept) {
        return res.status(400).json({ success: false, error: 'Department not in this tenant' });
      }
      targetDepartmentId = String(body.department_id);
      patch.department_id = targetDepartmentId;
    }

    const name = body.name != null ? String(body.name).trim() : site.name;
    if (!name) return res.status(400).json({ success: false, error: 'Location name is required' });
    if (name !== site.name) patch.name = name;

    const latitude = body.latitude != null ? Number(body.latitude) : Number(site.latitude);
    const longitude = body.longitude != null ? Number(body.longitude) : Number(site.longitude);
    const radius = body.radius != null ? Number(body.radius) : Number(site.radius);
    const geomError = validateSiteGeometry({ latitude, longitude, radius });
    if (geomError) return res.status(400).json({ success: false, error: geomError });
    const coordsChanged = latitude !== Number(site.latitude) || longitude !== Number(site.longitude);
    if (latitude !== Number(site.latitude)) patch.latitude = latitude;
    if (longitude !== Number(site.longitude)) patch.longitude = longitude;
    if (Math.round(radius) !== Number(site.radius)) patch.radius = Math.round(radius);

    if (body.address !== undefined) {
      patch.address = body.address != null ? String(body.address).trim().slice(0, 500) || null : null;
    } else if (coordsChanged) {
      // Stale address would otherwise point at the old coordinates; clear it
      // so the UI re-resolves (or falls back to coordinates) for the new pin.
      patch.address = null;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(200).json({ success: true, data: site });
    }

    if (
      (patch.name || patch.department_id) &&
      (await siteNameClashInDepartment(companyId, targetDepartmentId, name, site.id))
    ) {
      return res.status(409).json({
        success: false,
        error: 'An active location with this name already exists in this department',
      });
    }

    const { data, error } = await supabase
      .from('sites')
      .update(patch)
      .eq('id', site.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          success: false,
          error: 'An active location with this name already exists in this department',
        });
      }
      throw error;
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update site' });
  }
});

router.delete('/sites/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  try {
    const site = await loadManageableSite(req.params.id, requester, companyId, res);
    if (!site) return;

    // Remove assignments first so no orphaned employee_sites rows remain even if
    // the FK is not ON DELETE CASCADE.
    const { error: unassignError } = await supabase
      .from('employee_sites')
      .delete()
      .eq('site_id', site.id);
    if (unassignError) throw unassignError;

    const { error } = await supabase
      .from('sites')
      .delete()
      .eq('id', site.id)
      .eq('company_id', companyId);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to delete site' });
  }
});

router.post('/employee-sites', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  try {
    const { employee_uid, site_id } = req.body;
    const { data: employee } = await supabase
      .from('users')
      .select('uid, department, department_id, company_id')
      .eq('uid', employee_uid)
      .eq('company_id', companyId)
      .single();
    const { data: site } = await supabase
      .from('sites')
      .select('id, department_id, company_id')
      .eq('id', site_id)
      .eq('company_id', companyId)
      .single();
    if (!employee || !site) {
      return res.status(400).json({ success: false, error: 'Invalid employee or site' });
    }
    if (requester.role === ROLES.MANAGER) {
      const managerDeptId = await resolveRequesterDepartmentId(requester, companyId);
      const employeeDeptId = employee.department_id
        ? String(employee.department_id)
        : (await getDepartmentIdByName(employee.department, companyId));
      if (!managerDeptId || employeeDeptId !== managerDeptId) {
        return res
          .status(403)
          .json({ success: false, error: 'Managers can only assign their department employees' });
      }
      if (String(site.department_id) !== managerDeptId) {
        return res
          .status(403)
          .json({ success: false, error: 'Managers can only assign employees to their department sites' });
      }
    }
    const { data, error } = await supabase
      .from('employee_sites')
      .insert({ employee_uid, site_id })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to assign employee to site' });
  }
});

router.get('/attendance', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const isEmployee = requester.role === ROLES.EMPLOYEE;
  const hasAttendanceGrant = await hasAnyPermission(supabase, requester, ATTENDANCE_READ_PERMISSIONS);
  if (!isEmployee && !hasAttendanceGrant && !(await requireAnyAdminPermission(requester, ATTENDANCE_READ_PERMISSIONS, res))) return;
  if (isEmployee && !hasAttendanceGrant) {
    // Default employee behavior remains own attendance only.
  }
  try {
    let query = supabase
      .from('attendance_records')
      .select('*')
      .eq('company_id', companyId)
      .order('timestamp', { ascending: false });
    if (isEmployee && !hasAttendanceGrant) {
      query = supabase
        .from('attendance_records')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_uid', requester.uid)
        .order('timestamp', { ascending: false });
    } else if (hasAttendanceGrant && requester.role !== ROLES.SUPER_ADMIN) {
      const visibleUids = await resolveScopedUserUids(supabase, requester, companyId, 'view_attendance');
      const mfilter = visibleUids?.length ? visibleUids : ['00000000-0000-0000-0000-000000000000'];
      query = supabase
        .from('attendance_records')
        .select('*')
        .eq('company_id', companyId)
        .in('user_uid', mfilter)
        .order('timestamp', { ascending: false });
    }
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch attendance' });
  }
});

router.post('/attendance', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manual_attendance', res))) return;

  try {
    const { username, type, timestamp, location, employee_name: employeeName } = req.body || {};
    if (!username || !type) {
      return res.status(400).json({ success: false, error: 'username and type are required' });
    }
    const normalizedType = String(type).toLowerCase();
    if (!['checkin', 'checkout'].includes(normalizedType)) {
      return res.status(400).json({ success: false, error: 'type must be checkin or checkout' });
    }

    let employeeQuery = supabase
      .from('users')
      .select('uid, username, name, department, department_id')
      .eq('company_id', companyId)
      .eq('username', username)
      .maybeSingle();
    const { data: employee, error: employeeError } = await employeeQuery;
    if (employeeError) throw employeeError;
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    if (!(await hasPermission(supabase, { ...requester, company_id: companyId }, 'manual_attendance', {
      companyId, targetUid: employee.uid, userUid: employee.uid, departmentId: employee.department_id, department: employee.department,
    }))) return res.status(403).json({ success: false, error: 'You cannot correct attendance for this department' });

    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        user_uid: employee.uid,
        company_id: companyId,
        username: employee.username,
        employee_name: employeeName || employee.name || employee.username,
        type: normalizedType,
        timestamp: timestamp || new Date().toISOString(),
        location: location || null,
        auth_method: 'manual',
        is_manual: true,
        created_by: requester.username || requester.uid,
      })
      .select()
      .single();
    if (error) throw error;
    await markAttendanceSummaryDirty(companyId, employee.uid, timestamp || new Date().toISOString());
    await writeAuthorizationAudit(supabase, {
      companyId,
      actorUid: requester.uid,
      targetUid: employee.uid,
      action: 'manual_attendance_created',
      afterState: data,
      metadata: { source: 'manual' },
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create attendance record' });
  }
});

router.patch('/attendance/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manual_attendance', res))) return;

  try {
    const { id } = req.params;
    const { type, timestamp, location } = req.body || {};
    const updates = { updated_at: new Date().toISOString(), updated_by: requester.username || requester.uid };
    if (type) {
      const normalizedType = String(type).toLowerCase();
      if (!['checkin', 'checkout'].includes(normalizedType)) {
        return res.status(400).json({ success: false, error: 'type must be checkin or checkout' });
      }
      updates.type = normalizedType;
    }
    if (timestamp) updates.timestamp = timestamp;
    if (location !== undefined) updates.location = location;

    let existingQuery = supabase.from('attendance_records').select('id, username, user_uid, timestamp, type, checkout_source, is_manual').eq('id', id).eq('company_id', companyId);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, error: 'Attendance record not found' });

    if (String(existing.checkout_source || '').toLowerCase() === 'automatic_schedule') {
      // Editing the scheduled event is an explicit manual correction. Keep the
      // raw row, but make the correction visible to the authoritative pairing
      // layer instead of leaving the automatic source authoritative.
      updates.checkout_source = 'manual';
      updates.checkout_reason = 'MANUAL_CORRECTION';
      updates.is_manual = true;
      updates.auth_method = 'manual';
    }

    if (requester.role !== ROLES.SUPER_ADMIN) {
      const { data: employee } = await supabase
        .from('users')
        .select('department, department_id, uid')
        .eq('company_id', companyId)
        .eq('uid', existing.user_uid)
        .maybeSingle();
      if (!employee || !(await hasPermission(supabase, { ...requester, company_id: companyId }, 'manual_attendance', {
        companyId, targetUid: employee.uid, userUid: employee.uid, departmentId: employee.department_id, department: employee.department,
      }))) return res.status(403).json({ success: false, error: 'You cannot correct attendance for this department' });
    }

    const { data, error } = await supabase
      .from('attendance_records')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    await markAttendanceSummaryDirty(companyId, existing.user_uid, existing.timestamp, updates.timestamp || existing.timestamp);
    await writeAuthorizationAudit(supabase, {
      companyId,
      actorUid: requester.uid,
      targetUid: existing.user_uid,
      action: 'manual_attendance_updated',
      beforeState: existing,
      afterState: data,
      metadata: { source: 'manual' },
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update attendance record' });
  }
});

router.delete('/attendance/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manual_attendance', res))) return;

  try {
    const { id } = req.params;
    const { data: existing, error: existingError } = await supabase
      .from('attendance_records')
      .select('id, username, user_uid, timestamp')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, error: 'Attendance record not found' });

    if (requester.role !== ROLES.SUPER_ADMIN) {
      const { data: employee } = await supabase
        .from('users')
        .select('department, department_id, uid')
        .eq('company_id', companyId)
        .eq('uid', existing.user_uid)
        .maybeSingle();
      if (!employee || !(await hasPermission(supabase, { ...requester, company_id: companyId }, 'manual_attendance', {
        companyId, targetUid: employee.uid, userUid: employee.uid, departmentId: employee.department_id, department: employee.department,
      }))) return res.status(403).json({ success: false, error: 'You cannot correct attendance for this department' });
    }

    const { error } = await supabase.from('attendance_records').delete().eq('id', id).eq('company_id', companyId);
    if (error) throw error;
    await markAttendanceSummaryDirty(companyId, existing.user_uid, existing.timestamp);
    await writeAuthorizationAudit(supabase, {
      companyId,
      actorUid: requester.uid,
      targetUid: existing.user_uid,
      action: 'manual_attendance_deleted',
      beforeState: existing,
      metadata: { source: 'manual' },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to delete attendance record' });
  }
});

router.get('/leaves', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const isEmployee = requester.role === ROLES.EMPLOYEE;
  const hasLeaveViewGrant = await hasPermission(supabase, requester, 'view_leave_requests');
  const hasApprovalGrant = await hasAnyPermission(supabase, requester, ['approve_leave', 'reject_leave']);
  if (!isEmployee && !hasLeaveViewGrant && !hasApprovalGrant && requester.role !== ROLES.SUPER_ADMIN) {
    res.status(403).json({ success: false, error: 'Permission required: view_leave_requests or approval authority' });
    return;
  }
  try {
    let query = supabase
      .from('leave_requests')
      .select('*')
      .eq('company_id', companyId)
      .order('requested_at', { ascending: false });
    if (isEmployee && !hasLeaveViewGrant && !hasApprovalGrant) {
      query = supabase
        .from('leave_requests')
        .select('*')
        .eq('company_id', companyId)
        .eq('employee_uid', requester.uid)
        .order('requested_at', { ascending: false });
    }
    const { data, error } = await query;
    if (error) throw error;
    const visible = [];
    for (const row of data || []) {
      if (isEmployee && !hasLeaveViewGrant && !hasApprovalGrant && String(row.employee_uid) === String(requester.uid)) {
        visible.push(row);
        continue;
      }
      const { data: subject } = await supabase
        .from('users')
        .select('uid, department, department_id')
        .eq('uid', row.employee_uid)
        .eq('company_id', companyId)
        .maybeSingle();
      if (!subject) continue;
      const target = {
        companyId,
        targetUid: subject.uid,
        employeeUid: subject.uid,
        userUid: subject.uid,
        departmentId: subject.department_id,
        department: subject.department,
      };
      let allowed = requester.role === ROLES.SUPER_ADMIN;
      if (!allowed && hasLeaveViewGrant) allowed = await hasPermission(supabase, requester, 'view_leave_requests', target);
      if (!allowed && hasApprovalGrant && row.status === 'pending') {
        const progress = await getApprovalProgress(supabase, mapLeaveTypeToRequestType(row.leave_type), row.id);
        const pending = progress.find((step) => step.action === 'pending');
        if (pending) {
          allowed = await canUserActOnStep(supabase, requester, {
            ...pending,
            authority_type: pending.authority_type || (pending.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE'),
          }, subject.uid, companyId, mapLeaveTypeToRequestType(row.leave_type));
        }
      }
      if (allowed) visible.push(row);
    }
    const enriched = await enrichLeaveRequestsWithEmployees(supabase, companyId, visible);
    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch leaves' });
  }
});

const LEAVE_TYPES = ['annual', 'sick', 'casual'];

router.post('/leaves', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const isEmployee = requester.role === ROLES.EMPLOYEE;
  try {
    const body = req.body || {};
    const requestedEmployeeUid = String(body.employee_uid || '').trim();
    const employeeUid = isEmployee && !requestedEmployeeUid ? requester.uid : requestedEmployeeUid || requester.uid;
    const leaveType = String(body.leave_type || '').trim().toLowerCase();
    const startDate = String(body.start_date || '').trim();
    const endDate = String(body.end_date || '').trim();
    const isHalfDay = Boolean(body.is_half_day);
    const halfDayPeriod = isHalfDay ? String(body.half_day_period || '').trim() || null : null;
    const reason = body.reason != null ? String(body.reason).trim() : '';

    if (!employeeUid) return res.status(400).json({ success: false, error: 'employee_uid is required' });
    if (!LEAVE_TYPES.includes(leaveType)) {
      return res.status(400).json({ success: false, error: `leave_type must be one of: ${LEAVE_TYPES.join(', ')}` });
    }
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: 'start_date and end_date must be valid dates (YYYY-MM-DD)' });
    }
    if (start > end) {
      return res.status(400).json({ success: false, error: 'start_date must be on or before end_date' });
    }
    if (isHalfDay && startDate !== endDate) {
      return res.status(400).json({ success: false, error: 'Half-day leave must be for a single day' });
    }

    const { data: employee, error: employeeError } = await supabase
      .from('users')
      .select('uid, username, name, department, department_id, company_id')
      .eq('uid', employeeUid)
      .eq('company_id', companyId)
      .single();
    if (employeeError || !employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    const isOwnRequest = String(employee.uid) === String(requester.uid);
    if (!isOwnRequest || !isEmployee) {
      if (!(await requireAdminPermission(requester, 'create_leave_request', res, {
        companyId, targetUid: employee.uid, employeeUid: employee.uid, departmentId: employee.department_id, department: employee.department,
      }))) return;
    } else if (!isOwnRequest) {
      return res.status(403).json({ success: false, error: 'You can only create your own leave request' });
    }

    const days = isHalfDay ? 0.5 : countBusinessDays(startDate, endDate);
    if (days <= 0) {
      return res.status(400).json({
        success: false,
        error: 'The selected date range contains no working days. Choose a range that includes at least one weekday.',
      });
    }

    const { allocated, used, remaining } = await resolveRemainingLeaveForEmployee(employee.uid, companyId, leaveType);
    const insufficientBalance = days > remaining;
    const overrideAcknowledged = !isEmployee && Boolean(body.override_acknowledged);

    // Dry run: let the UI show the balance/override warning before the
    // employee actually acts on it, without creating anything.
    if (body.dry_run) {
      return res.status(200).json({
        success: true,
        data: { days, allocated, used, remaining, insufficientBalance },
      });
    }

    // HR/Admin (the only requesters who can reach this route — gated by
    // create_leave_request above) are allowed to override an insufficient
    // balance, but only after explicitly acknowledging it. The client
    // cannot skip this by just sending override_acknowledged: true — the
    // balance itself is always recomputed here, never taken from the
    // client, so the flag only ever confirms a warning this same request
    // already independently verified.
    if (insufficientBalance && !overrideAcknowledged) {
      return res.status(409).json({
        success: false,
        error: `Insufficient ${leaveType} leave balance. Available: ${remaining}, requested: ${days}.`,
        code: 'INSUFFICIENT_BALANCE',
        data: { days, allocated, used, remaining },
      });
    }

    const overrideNote = insufficientBalance
      ? `HR override: created despite insufficient ${leaveType} leave balance (requested ${days}, available ${remaining}).`
      : null;

    const { data, error } = await supabase
      .from('leave_requests')
      .insert({
        company_id: companyId,
        employee_uid: employee.uid,
        employee_id: employee.username,
        employee_name: employee.name || employee.username,
        employee_username: employee.username,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days,
        is_half_day: isHalfDay,
        half_day_period: halfDayPeriod,
        reason: reason || null,
        category: employee.department_id ? String(employee.department_id) : null,
        status: 'pending',
        admin_notes: overrideNote,
      })
      .select()
      .single();
    if (error) throw error;

    // Initialize the approval snapshot at submission time so later workflow
    // edits or department changes cannot reroute this request. The existing
    // lazy initialization path remains available for older rows.
    try {
      const requestType = mapLeaveTypeToRequestType(leaveType);
      const init = await initializeApprovalSteps(supabase, {
        companyId,
        requestType,
        requestId: data.id,
        employeeUid: employee.uid,
      });
      if (init.workflowId) {
        const approvalDepartmentId = await (async () => {
          const { data: assignment } = await supabase
            .from('user_department_assignments')
            .select('department_id')
            .eq('user_uid', employee.uid)
            .eq('is_active', true)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          return assignment?.department_id || employee.department_id || null;
        })();
        await supabase.from('leave_requests').update({
          workflow_id: init.workflowId,
          approval_department_id: approvalDepartmentId,
        }).eq('id', data.id).eq('company_id', companyId);
        data.workflow_id = init.workflowId;
        data.approval_department_id = approvalDepartmentId;
      }
    } catch (approvalError) {
      console.warn('[approvalEngine] leave approval initialization deferred:', approvalError.message);
    }

    await writeAuditLog(supabase, {
      actorUid: requester.uid,
      targetUid: employee.uid,
      action: insufficientBalance ? 'leave_request_created_override' : 'leave_request_created',
    });

    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create leave request' });
  }
});

router.patch('/leaves/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    const permissionKey = status === 'approved' ? 'approve_leave' : status === 'rejected' ? 'reject_leave' : null;
    if (!permissionKey) {
      return res.status(400).json({ success: false, error: 'Unsupported leave status' });
    }
    if (!(await requireAdminPermission(requester, permissionKey, res))) return;
    const tenantUids = await fetchCompanyUserUids(supabase, companyId);
    const { data: requestRow } = await supabase
      .from('leave_requests')
      .select('id, employee_uid, status, leave_type, start_date, end_date, current_step')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (!requestRow) return res.status(404).json({ success: false, error: 'Leave request not found' });
    if (!tenantUids.includes(requestRow.employee_uid)) {
      return res.status(404).json({ success: false, error: 'Leave request not found' });
    }
    if (requestRow.status !== 'pending') return res.status(400).json({ success: false, error: 'Leave already processed' });
    const requestType = mapLeaveTypeToRequestType(requestRow.leave_type);
    let progress = await getApprovalProgress(supabase, requestType, id);
    if (!progress.length) {
      const init = await initializeApprovalSteps(supabase, {
        companyId,
        requestType,
        requestId: id,
        employeeUid: requestRow.employee_uid,
      });
      if (init.workflowId) {
        await supabase.from('leave_requests').update({
          workflow_id: init.workflowId,
          approval_department_id: init.steps?.[0]?.approval_department_id || null,
        }).eq('id', id);
      }
    }

    const action = status === 'approved' ? 'approved' : 'rejected';
    const result = await processApprovalStep(supabase, {
      companyId,
      requestType,
      requestId: id,
      employeeUid: requestRow.employee_uid,
      requester,
      action,
      notes: admin_notes,
      onFinalApprove: async () => {},
    });

    const finalStatus = result.final ? result.status : 'pending';
    const updates = {
      status: finalStatus,
      current_step: result.currentStep,
      admin_notes: admin_notes || null,
    };
    if (result.final) {
      updates.processed_at = new Date().toISOString();
      updates.processed_by = requester.username || requester.email || requester.uid;
    }

    const { error } = await supabase
      .from('leave_requests')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw error;
    if (result.final && finalStatus === 'approved') {
      const start = new Date(`${requestRow.start_date}T00:00:00Z`);
      const end = new Date(`${requestRow.end_date}T00:00:00Z`);
      for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
        await markAttendanceSummaryDirty(companyId, requestRow.employee_uid, cursor.toISOString());
      }
    }
    res.status(200).json({ success: true, data: { status: finalStatus, approval: result } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to process leave request' });
  }
});

router.get('/permissions/meta', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  res.status(200).json({
    success: true,
    data: {
      groups: MANAGER_PERMISSION_GROUPS,
      all: ALL_MANAGER_PERMISSIONS,
      defaults: DEFAULT_MANAGER_PERMISSIONS,
    },
  });
});

router.get('/managers', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const { companyId } = ctx;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('uid, username, email, name, role, department, is_active, created_at')
      .eq('company_id', companyId)
      .eq('role', ROLES.MANAGER)
      .order('name', { ascending: true });
    if (error) throw error;
    const rows = await Promise.all((data || []).map(async (permissionUser) => ({
      ...permissionUser,
      permissions: await getManagerPermissions(supabase, permissionUser.uid),
    })));
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch managers' });
  }
});

router.get('/managers/:uid/permissions', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const { companyId } = ctx;
  const { uid } = req.params;
  try {
    const { data: permissionUser } = await supabase
      .from('users')
      .select('uid, role')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .eq('role', ROLES.MANAGER)
      .maybeSingle();
    if (!permissionUser) return res.status(404).json({ success: false, error: 'Manager not found' });
    const permissions = await getManagerPermissions(supabase, uid);
    const grants = await getEffectiveGrants(supabase, permissionUser);
    res.status(200).json({ success: true, data: permissions, grants });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch permissions' });
  }
});

router.put('/managers/:uid/permissions', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const { requester, companyId } = ctx;
  const { uid } = req.params;
  if (rejectSelfAdministrativeChange(requester, uid, res)) return;
  try {
    const { data: permissionUser } = await supabase
      .from('users')
      .select('uid, role, company_id, department_id, department, is_active')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .eq('role', ROLES.MANAGER)
      .maybeSingle();
    if (!permissionUser) return res.status(404).json({ success: false, error: 'Manager not found' });
    if (permissionUser.is_active === false) return res.status(400).json({ success: false, error: 'Inactive users cannot receive permissions' });

    const requested = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const requestedSet = new Set(requested.filter((key) => ALL_MANAGER_PERMISSIONS.includes(key)));
    const rows = ALL_MANAGER_PERMISSIONS.map((permissionKey) => ({
      manager_uid: uid,
      permission_key: permissionKey,
      granted: requestedSet.has(permissionKey),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('manager_permissions')
      .upsert(rows, { onConflict: 'manager_uid,permission_key' });
    if (error) throw error;

    const defaultScope = permissionUser.department_id ? 'DEPARTMENT' : 'COMPANY';
    const defaultDepartmentId = defaultScope === 'DEPARTMENT' ? permissionUser.department_id : null;
    await writeAuthorizationAudit(supabase, {
      companyId,
      actorUid: requester.uid,
      targetUid: uid,
      action: 'permissions_changed',
      afterState: { permissions: Array.from(requestedSet), scope_type: defaultScope, department_id: defaultDepartmentId },
    });
    await writeAuditLog(supabase, {
      actorUid: requester.uid,
      targetUid: uid,
      action: 'permissions_changed',
    });
    res.status(200).json({ success: true, data: Array.from(requestedSet) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update permissions' });
  }
});

// ---------------------------------------------------------------------------
// Scoped authorization administration. Legacy manager endpoints above remain
// unchanged for older web/mobile clients; these endpoints work for any user.
// ---------------------------------------------------------------------------

router.get('/organization-roles', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  if (ctx.requester.role !== ROLES.SUPER_ADMIN && !(await hasAnyPermission(supabase, ctx.requester, ['view_employees', 'edit_user']))) {
    return res.status(403).json({ success: false, error: 'Permission denied' });
  }
  const { data, error } = await supabase
    .from('organization_roles')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('name');
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data: data || [] });
});

router.post('/organization-roles', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const name = String(req.body?.name || '').trim();
  const code = String(req.body?.code || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!name || !code) return res.status(400).json({ success: false, error: 'Role name is required' });
  const { data, error } = await supabase
    .from('organization_roles')
    .insert({ company_id: ctx.companyId, name, code, description: req.body?.description || null })
    .select('*')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'organization_role_created',
    afterState: data,
  });
  return res.status(201).json({ success: true, data });
});

router.patch('/organization-roles/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const roleId = String(req.params.id || '');
  const { data: existing, error: findError } = await supabase
    .from('organization_roles')
    .select('*')
    .eq('id', roleId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (findError) return res.status(500).json({ success: false, error: findError.message });
  if (!existing) return res.status(404).json({ success: false, error: 'Organizational role not found' });

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const code = req.body?.code !== undefined
    ? String(req.body.code).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
    : existing.code;
  if (!name || !code) return res.status(400).json({ success: false, error: 'Role name and code are required' });
  const updates = {
    name,
    code,
    description: req.body?.description !== undefined ? (req.body.description || null) : existing.description,
    is_active: req.body?.is_active !== undefined ? Boolean(req.body.is_active) : existing.is_active,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('organization_roles')
    .update(updates)
    .eq('id', roleId)
    .eq('company_id', ctx.companyId)
    .select('*')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'organization_role_updated',
    beforeState: existing,
    afterState: data,
  });
  return res.json({ success: true, data });
});

router.delete('/organization-roles/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const roleId = String(req.params.id || '');
  const { data: existing, error: findError } = await supabase
    .from('organization_roles')
    .select('*')
    .eq('id', roleId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (findError) return res.status(500).json({ success: false, error: findError.message });
  if (!existing) return res.status(404).json({ success: false, error: 'Organizational role not found' });
  const { data, error } = await supabase
    .from('organization_roles')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', roleId)
    .eq('company_id', ctx.companyId)
    .select('*')
    .single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'organization_role_deactivated',
    beforeState: existing,
    afterState: data,
  });
  return res.json({ success: true, data });
});

router.get('/users/:uid/departments', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const targetUid = String(req.params.uid || '');
  if (String(ctx.requester.uid) !== targetUid && ctx.requester.role !== ROLES.SUPER_ADMIN) {
    const { data: targetUser } = await supabase.from('users').select('uid, department_id, department').eq('uid', targetUid).eq('company_id', ctx.companyId).maybeSingle();
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });
    const allowed = await hasAnyPermission(supabase, ctx.requester, ['view_employees', 'assign_user_department'], {
      companyId: ctx.companyId,
      targetUid,
      userUid: targetUid,
      departmentId: targetUser.department_id,
      departmentIds: await getUserDepartmentIds(supabase, targetUid, targetUser),
      department: targetUser.department,
    });
    if (!allowed) return res.status(403).json({ success: false, error: 'Permission denied' });
  }
  const { data, error } = await supabase
    .from('user_department_assignments')
    .select('id, user_uid, department_id, is_primary, is_active, assigned_by_uid, departments(id, name)')
    .eq('company_id', ctx.companyId)
    .eq('user_uid', targetUid)
    .eq('is_active', true)
    .order('is_primary', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data: data || [] });
});

router.put('/users/:uid/departments', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const targetUid = req.params.uid;
  if (rejectSelfAdministrativeChange(requester, targetUid, res)) return;
  const { data: target } = await supabase
    .from('users')
    .select('uid, role, department_id, company_id, is_active')
    .eq('uid', targetUid)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (target.role === ROLES.SUPER_ADMIN) return res.status(403).json({ success: false, error: 'Cannot modify super admin departments' });
  if (target.is_active === false) return res.status(400).json({ success: false, error: 'Inactive users cannot receive department assignments' });
  const requested = Array.isArray(req.body?.department_ids) ? [...new Set(req.body.department_ids.map(String))] : [];
  const primary = req.body?.primary_department_id ? String(req.body.primary_department_id) : requested[0] || null;
  if (primary && !requested.includes(primary)) return res.status(400).json({ success: false, error: 'Primary department must be assigned' });
  const { data: departments, error: departmentError } = await supabase
    .from('departments').select('id, name').eq('company_id', companyId).in('id', requested.length ? requested : ['00000000-0000-0000-0000-000000000000']);
  if (departmentError) return res.status(500).json({ success: false, error: departmentError.message });
  if ((departments || []).length !== requested.length) return res.status(400).json({ success: false, error: 'Invalid department assignment' });
  const { data: before, error: beforeError } = await supabase.from('user_department_assignments')
    .select('*').eq('company_id', companyId).eq('user_uid', targetUid).eq('is_active', true);
  if (beforeError) return res.status(500).json({ success: false, error: beforeError.message });
  if (requester.role !== ROLES.SUPER_ADMIN) {
    const departmentsToAuthorize = [...new Set([...requested, ...(requested.length ? [] : (before || []).map((row) => String(row.department_id)))])];
    if (!departmentsToAuthorize.length) return res.status(403).json({ success: false, error: 'A scoped administrator cannot clear an unassigned user' });
    for (const departmentId of departmentsToAuthorize) {
      if (!(await hasPermission(supabase, { ...requester, company_id: companyId }, 'assign_user_department', { companyId, targetUid, userUid: targetUid, departmentId }))) {
        return res.status(403).json({ success: false, error: 'You cannot assign users to one or more selected departments' });
      }
    }
  }
  try {
    await replaceDepartmentAssignmentsAtomic({
      companyId,
      targetUid,
      departmentIds: requested,
      primaryDepartmentId: primary,
      actorUid: requester.uid,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to replace department assignments' });
  }
  await writeAuthorizationAudit(supabase, {
    companyId, actorUid: requester.uid, targetUid, action: 'department_assignments_changed',
    beforeState: { assignments: before || [] }, afterState: { department_ids: requested, primary_department_id: primary },
  });
  return res.json({ success: true, data: { department_ids: requested, primary_department_id: primary } });
});

router.get('/users/:uid/grants', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { data: target } = await supabase.from('users').select('uid, role, company_id, department_id, department').eq('uid', req.params.uid).eq('company_id', ctx.companyId).maybeSingle();
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (ctx.requester.role !== ROLES.SUPER_ADMIN && !(await hasAnyPermission(supabase, ctx.requester, ['view_employees', 'assign_user_permissions'], { companyId: ctx.companyId, targetUid: target.uid, userUid: target.uid, departmentId: target.department_id, departmentIds: await getUserDepartmentIds(supabase, target.uid, target), department: target.department }))) {
    return res.status(403).json({ success: false, error: 'Permission denied' });
  }
  const grants = await getEffectiveGrants(supabase, target);
  return res.json({ success: true, data: grants });
});

router.put('/users/:uid/grants', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const targetUid = req.params.uid;
  if (rejectSelfAdministrativeChange(requester, targetUid, res)) return;
  const { data: target } = await supabase.from('users').select('uid, role, company_id, department_id, department, is_active').eq('uid', targetUid).eq('company_id', companyId).maybeSingle();
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (target.role === ROLES.SUPER_ADMIN) return res.status(403).json({ success: false, error: 'Cannot modify super admin permissions' });
  if (target.is_active === false) return res.status(400).json({ success: false, error: 'Inactive users cannot receive permissions' });
  const grants = Array.isArray(req.body?.grants) ? req.body.grants : [];
  if (grants.length > 100) return res.status(400).json({ success: false, error: 'Too many grants' });
  for (const grant of grants) {
    const key = String(grant.permission_key || '').trim();
    const scopeType = String(grant.scope_type || 'DEPARTMENT').toUpperCase();
    const departmentId = grant.department_id ? String(grant.department_id) : null;
    const definition = PERMISSION_DEFINITIONS[key];
    if (!ALL_MANAGER_PERMISSIONS.includes(key) || !['OWN', 'DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY'].includes(scopeType) || (definition?.scopes && !definition.scopes.includes(scopeType))) {
      return res.status(400).json({ success: false, error: `Invalid permission grant: ${key}` });
    }
    if (scopeType === 'DEPARTMENT' && !departmentId) return res.status(400).json({ success: false, error: 'Department scope requires department_id' });
    if (requester.role !== ROLES.SUPER_ADMIN && !(await canDelegatePermission(supabase, requester, targetUid, key, scopeType, departmentId))) {
      return res.status(403).json({ success: false, error: `You cannot delegate ${key} with ${scopeType} scope` });
    }
  }
  const before = await getEffectiveGrants(supabase, target);
  try {
    const requestedRows = grants.map((grant) => ({
      permissionKey: String(grant.permission_key).trim(),
      scopeType: String(grant.scope_type || 'DEPARTMENT').toUpperCase(),
      departmentId: grant.department_id || null,
      granted: grant.granted !== false,
    }));
    const existingCanonical = before.filter((grant) => grant.source !== 'legacy_manager');
    const revokedRows = existingCanonical
      .filter((existing) => !requestedRows.some((row) => row.permissionKey === existing.permission_key && row.scopeType === existing.scope_type && String(row.departmentId || '') === String(existing.department_id || '')))
      .map((existing) => ({
        permissionKey: existing.permission_key,
        scopeType: existing.scope_type,
        departmentId: existing.department_id || null,
        granted: false,
      }));
    await Promise.all([...requestedRows, ...revokedRows].map((grant) => upsertPermissionGrant(supabase, {
      companyId,
      principalUid: targetUid,
      permissionKey: grant.permissionKey,
      granted: grant.granted,
      scopeType: grant.scopeType,
      departmentId: grant.departmentId,
      source: requester.role === ROLES.SUPER_ADMIN ? 'super_admin' : 'delegated',
      delegatedByUid: requester.uid,
    })));
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to update grants' });
  }
  const after = await getEffectiveGrants(supabase, target);
  await writeAuthorizationAudit(supabase, { companyId, actorUid: requester.uid, targetUid, action: 'permission_grants_changed', beforeState: { grants: before }, afterState: { grants: after } });
  return res.json({ success: true, data: after });
});

router.get('/audit-logs', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const { companyId } = ctx;
  try {
    const { data: tenantUsers, error: usersError } = await supabase
      .from('users')
      .select('uid, username, name')
      .eq('company_id', companyId);
    if (usersError) throw usersError;
    const uidSet = (tenantUsers || []).map((u) => u.uid);
    const userMap = new Map((tenantUsers || []).map((u) => [u.uid, u]));
    if (uidSet.length === 0) return res.status(200).json({ success: true, data: [] });
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, actor_uid, target_uid, action, timestamp')
      .in('target_uid', uidSet)
      .order('timestamp', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.status(200).json({
      success: true,
      data: (data || []).map((row) => ({
        ...row,
        actor: userMap.get(row.actor_uid) || null,
        target: userMap.get(row.target_uid) || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch audit logs' });
  }
});

const workflowRoutes = require('./workflowRoutes');
const opsRoutes = require('./opsRoutes');
router.use(workflowRoutes);
router.use(opsRoutes);

module.exports = router;
