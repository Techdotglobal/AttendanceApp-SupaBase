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
  hasAnyPermission,
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
  mapLeaveTypeToRequestType,
} = require('../lib/approvalEngine');

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

const requireAdminPermission = async (requester, permissionKey, res) =>
  requirePermission(supabase, requester, permissionKey, res);

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
    .select('uid, username, email, report_email, name, role, department, department_id, position, work_mode, hire_date, is_active, created_at, company_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
    query = query.eq('department', requester.department);
  }
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

    let usersQuery = supabase
      .from('users')
      .select('uid, department, department_id, is_active')
      .eq('company_id', companyId);
    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
      usersQuery = usersQuery.eq('department', requester.department);
    }

    let departmentsQuery = supabase
      .from('departments')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name', { ascending: true });
    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
      const managerDept = await getRequesterDepartment(requester, companyId);
      if (!managerDept) {
        return res.status(200).json({
          success: true,
          data: {
            departmentDistribution: [],
            insights: {
              totalUsers: 0,
              activeUsers: 0,
              attendanceLast7Days: 0,
              avgAttendancePerActiveUser7d: 0,
              trackedDepartments: 0,
              unassignedUsers: 0,
            },
          },
        });
      }
      departmentsQuery = departmentsQuery.eq('id', managerDept.id);
    }

    let attendance7dQuery = supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('timestamp', sinceIso);
    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('department', requester.department);
      const muids = (deptUsers || []).map((u) => u.uid).filter(Boolean);
      attendance7dQuery = attendance7dQuery.in(
        'user_uid',
        muids.length ? muids : ['00000000-0000-0000-0000-000000000000']
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
    let usersQuery = supabase
      .from('users')
      .select('uid, department, is_active', { count: 'exact' })
      .eq('company_id', companyId);
    if (requester.role === ROLES.MANAGER) {
      usersQuery = usersQuery.eq('department', requester.department);
    }

    const departmentsQuery = supabase
      .from('departments')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId);

    let attendanceQuery = supabase
      .from('attendance_records')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId);
    if (requester.role === ROLES.MANAGER) {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('department', requester.department);
      const muids = (deptUsers || []).map((u) => u.uid).filter(Boolean);
      attendanceQuery = supabase
        .from('attendance_records')
        .select('id', { count: 'exact' })
        .eq('company_id', companyId)
        .in('user_uid', muids.length ? muids : ['00000000-0000-0000-0000-000000000000']);
    }

    let leaveQuery = supabase
      .from('leave_requests')
      .select('id, status', { count: 'exact' })
      .eq('company_id', companyId);
    if (requester.role === ROLES.MANAGER) {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('department', requester.department);
      const muids = (deptUsers || []).map((u) => u.uid).filter(Boolean);
      leaveQuery = supabase
        .from('leave_requests')
        .select('id, status', { count: 'exact' })
        .eq('company_id', companyId)
        .in('employee_uid', muids.length ? muids : ['00000000-0000-0000-0000-000000000000']);
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
  if (!(await requireAdminPermission(requester, 'view_employees', res))) return;
  try {
    const { data, error } = await getUsersBaseQuery(requester, companyId);
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
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
      .select('uid, username, email, report_email, name, role, department, department_id, position, work_mode, hire_date, is_active, created_at, updated_at, company_id')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .single();
    if (targetError || !targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const access = assertCanManageUser(requester, targetUser, {
      tenantWide: requester.tenantWidePeopleAccess,
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
      .select('uid, username, email, role, department, company_id, is_active')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .single();
    if (targetError || !targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const access = assertCanManageUser(requester, targetUser, {
      tenantWide: requester.tenantWidePeopleAccess,
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
      annual_leaves !== undefined ||
      sick_leaves !== undefined ||
      casual_leaves !== undefined;

    const VALID_WORK_MODES = ['in_office', 'semi_remote', 'fully_remote'];
    if (work_mode !== undefined && !VALID_WORK_MODES.includes(work_mode)) {
      return res.status(400).json({
        success: false,
        error: `Invalid work_mode. Must be one of: ${VALID_WORK_MODES.join(', ')}`,
      });
    }

    if (profileFieldsTouched && !canEditAnyProfile(requester, { tenantWide: requester.tenantWidePeopleAccess })) {
      return res.status(403).json({
        success: false,
        error: 'Permission denied: edit_user with tenant-wide people access is required',
      });
    }
    if (profileFieldsTouched && !(await requireAdminPermission(requester, 'edit_user', res))) return;
    if (role !== undefined && role !== targetUser.role && !(await requireAdminPermission(requester, 'change_user_role', res))) return;
    if (is_active !== undefined && Boolean(is_active) !== Boolean(targetUser.is_active)) {
      const key = is_active ? 'activate_user' : 'deactivate_user';
      if (!(await requireAdminPermission(requester, key, res))) return;
    }
    const leaveTouched =
      annual_leaves !== undefined || sick_leaves !== undefined || casual_leaves !== undefined;
    if (leaveTouched && !(await requireAdminPermission(requester, 'edit_leave_balance', res))) return;

    if (
      requester.role === ROLES.MANAGER &&
      !requester.tenantWidePeopleAccess &&
      role &&
      role !== targetUser.role
    ) {
      return res.status(403).json({ success: false, error: 'Managers cannot update roles' });
    }
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
        updates.department = null;
        updates.department_id = null;
      } else {
        const ensured = await ensureDepartmentForCompany(companyId, trimmedDept);
        updates.department = ensured?.name || normalizeDepartmentName(trimmedDept);
        updates.department_id = ensured?.id || null;
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

    const leave_balance = await resolveLeaveBalanceForUser(uid, companyId);
    const { data: refreshed } = await supabase
      .from('users')
      .select('uid, username, email, report_email, name, role, department, department_id, position, work_mode, hire_date, is_active, updated_at')
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
  if (!(await requireAnyAdminPermission(requester, ATTENDANCE_READ_PERMISSIONS, res))) return;
  try {
    let query = supabase
      .from('attendance_records')
      .select('*')
      .eq('company_id', companyId)
      .order('timestamp', { ascending: false });
    if (requester.role === ROLES.MANAGER) {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('department', requester.department);
      const muids = (deptUsers || []).map((u) => u.uid).filter(Boolean);
      const mfilter = muids.length ? muids : ['00000000-0000-0000-0000-000000000000'];
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
      .select('uid, username, name, department')
      .eq('company_id', companyId)
      .eq('username', username)
      .maybeSingle();
    const { data: employee, error: employeeError } = await employeeQuery;
    if (employeeError) throw employeeError;
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess && employee.department !== requester.department) {
      return res.status(403).json({ success: false, error: 'Managers can only correct attendance for their department' });
    }

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

    let existingQuery = supabase.from('attendance_records').select('id, username').eq('id', id).eq('company_id', companyId);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, error: 'Attendance record not found' });

    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
      const { data: employee } = await supabase
        .from('users')
        .select('department')
        .eq('company_id', companyId)
        .eq('username', existing.username)
        .maybeSingle();
      if (!employee || employee.department !== requester.department) {
        return res.status(403).json({ success: false, error: 'Managers can only correct attendance for their department' });
      }
    }

    const { data, error } = await supabase
      .from('attendance_records')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
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
      .select('id, username')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, error: 'Attendance record not found' });

    if (requester.role === ROLES.MANAGER && !requester.tenantWidePeopleAccess) {
      const { data: employee } = await supabase
        .from('users')
        .select('department')
        .eq('company_id', companyId)
        .eq('username', existing.username)
        .maybeSingle();
      if (!employee || employee.department !== requester.department) {
        return res.status(403).json({ success: false, error: 'Managers can only correct attendance for their department' });
      }
    }

    const { error } = await supabase.from('attendance_records').delete().eq('id', id).eq('company_id', companyId);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to delete attendance record' });
  }
});

router.get('/leaves', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'view_leave_requests', res))) return;
  try {
    let query = supabase
      .from('leave_requests')
      .select('*')
      .eq('company_id', companyId)
      .order('requested_at', { ascending: false });
    if (requester.role === ROLES.MANAGER) {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('department', requester.department);
      const muids = (deptUsers || []).map((u) => u.uid).filter(Boolean);
      const mfilter = muids.length ? muids : ['00000000-0000-0000-0000-000000000000'];
      query = supabase
        .from('leave_requests')
        .select('*')
        .eq('company_id', companyId)
        .in('employee_uid', mfilter)
        .order('requested_at', { ascending: false });
    }
    const { data, error } = await query;
    if (error) throw error;
    const enriched = await enrichLeaveRequestsWithEmployees(supabase, companyId, data || []);
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
  if (!(await requireAdminPermission(requester, 'create_leave_request', res))) return;
  try {
    const body = req.body || {};
    const employeeUid = String(body.employee_uid || '').trim();
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
    if (requester.role === ROLES.MANAGER && employee.department !== requester.department) {
      return res.status(403).json({ success: false, error: 'Managers can only file leave for their own department' });
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
    const overrideAcknowledged = Boolean(body.override_acknowledged);

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
      .select('id, employee_uid, status, leave_type, current_step')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (!requestRow) return res.status(404).json({ success: false, error: 'Leave request not found' });
    if (!tenantUids.includes(requestRow.employee_uid)) {
      return res.status(404).json({ success: false, error: 'Leave request not found' });
    }
    if (requestRow.status !== 'pending') return res.status(400).json({ success: false, error: 'Leave already processed' });
    if (requester.role === ROLES.MANAGER) {
      const { data: emp } = await supabase
        .from('users')
        .select('uid, department')
        .eq('uid', requestRow.employee_uid)
        .eq('company_id', companyId)
        .single();
      if (!emp || emp.department !== requester.department) {
        return res.status(403).json({ success: false, error: 'Managers can only process department leaves' });
      }
    }

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
        await supabase.from('leave_requests').update({ workflow_id: init.workflowId }).eq('id', id);
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
      .neq('role', ROLES.SUPER_ADMIN)
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
      .neq('role', ROLES.SUPER_ADMIN)
      .maybeSingle();
    if (!permissionUser) return res.status(404).json({ success: false, error: 'User not found' });
    const permissions = await getManagerPermissions(supabase, uid);
    res.status(200).json({ success: true, data: permissions });
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
      .select('uid, role')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .neq('role', ROLES.SUPER_ADMIN)
      .maybeSingle();
    if (!permissionUser) return res.status(404).json({ success: false, error: 'User not found' });

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
