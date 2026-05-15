const express = require('express');
const { supabase } = require('../config/supabase');
const { getTenantCompanyId, fetchCompanyUserUids } = require('../lib/tenantScope');
const { normalizeDepartmentName, toLookupKey } = require('../lib/orgNormalize');

const router = express.Router();

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const getRequesterDepartment = async (requester, companyId) => {
  if (!requester?.department || !companyId) return null;
  const normalized = normalizeDepartmentName(requester.department);
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .eq('name', normalized)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const parseRequester = (req) => {
  const raw = req.get('x-user-context');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const requireRequester = (req, res) => {
  const requester = parseRequester(req);
  if (!requester || !requester.uid || !requester.role) {
    res.status(401).json({ success: false, error: 'Missing requester context' });
    return null;
  }
  if (requester.role === ROLES.EMPLOYEE) {
    res.status(403).json({ success: false, error: 'Employees cannot access admin portal' });
    return null;
  }
  return requester;
};

const requireSuperAdmin = (requester, res) => {
  if (requester.role !== ROLES.SUPER_ADMIN) {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return false;
  }
  return true;
};

/**
 * Resolves tenant from X-User-Context (company_id) or users row by uid.
 * @returns {Promise<{ requester: object, companyId: string }|null>}
 */
const withTenantContext = async (req, res) => {
  const requester = requireRequester(req, res);
  if (!requester) return null;
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
  return { requester, companyId };
};

const getUsersBaseQuery = (requester, companyId) => {
  let query = supabase
    .from('users')
    .select('uid, username, email, name, role, department, department_id, position, work_mode, is_active, created_at, company_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (requester.role === ROLES.MANAGER) {
    query = query.eq('department', requester.department);
  }
  return query;
};

router.get('/dashboard/stats', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
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

    const { data: companyUsers } = await supabase.from('users').select('uid').eq('company_id', companyId);
    const tenantUids = (companyUsers || []).map((u) => u.uid).filter(Boolean);

    let attendanceQuery = supabase
      .from('attendance_records')
      .select('id', { count: 'exact' })
      .in('user_uid', tenantUids.length ? tenantUids : ['00000000-0000-0000-0000-000000000000']);
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
        .in('user_uid', muids.length ? muids : ['00000000-0000-0000-0000-000000000000']);
    }

    let leaveQuery = supabase
      .from('leave_requests')
      .select('id, status', { count: 'exact' })
      .in('employee_uid', tenantUids.length ? tenantUids : ['00000000-0000-0000-0000-000000000000']);
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
  try {
    const { data, error } = await getUsersBaseQuery(requester, companyId);
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch users' });
  }
});

router.patch('/users/:uid', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const { uid } = req.params;
  const { role, department, work_mode, is_active } = req.body;
  try {
    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('uid, role, department, company_id')
      .eq('uid', uid)
      .eq('company_id', companyId)
      .single();
    if (targetError || !targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    if (requester.role === ROLES.MANAGER && targetUser.department !== requester.department) {
      return res.status(403).json({ success: false, error: 'Managers can only update users in their department' });
    }
    if (requester.role === ROLES.MANAGER && role && role !== targetUser.role) {
      return res.status(403).json({ success: false, error: 'Managers cannot update roles' });
    }
    if (requester.role === ROLES.MANAGER && department && department !== targetUser.department) {
      return res.status(403).json({ success: false, error: 'Managers cannot change departments' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (role !== undefined) updates.role = role;
    if (department !== undefined) {
      const normalizedDepartment = normalizeDepartmentName(department);
      updates.department = normalizedDepartment;
      if (normalizedDepartment) {
        const { data: deptRecord, error: deptLookupError } = await supabase
          .from('departments')
          .select('id')
          .eq('name', normalizedDepartment)
          .eq('company_id', companyId)
          .maybeSingle();
        if (deptLookupError) throw deptLookupError;
        if (deptRecord?.id) {
          updates.department_id = deptRecord.id;
        }
      }
    }
    if (work_mode !== undefined) updates.work_mode = work_mode;
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await supabase.from('users').update(updates).eq('uid', uid).eq('company_id', companyId);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update user' });
  }
});

router.get('/departments', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    if (requester.role === ROLES.MANAGER) {
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
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
  const { companyId } = ctx;
  try {
    const { name } = req.body;
    const normalizedName = normalizeDepartmentName(name);
    if (!normalizedName) return res.status(400).json({ success: false, error: 'Department name is required' });
    const lookupKey = toLookupKey(normalizedName);
    const { data, error } = await supabase
      .from('departments')
      .insert({
        name: normalizedName,
        normalized_name: lookupKey,
        company_id: companyId,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create department' });
  }
});

router.patch('/departments/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
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
    const { error: deptUpdateError } = await supabase
      .from('departments')
      .update({ name: normalizedName, normalized_name: toLookupKey(normalizedName) })
      .eq('id', id)
      .eq('company_id', companyId);
    if (deptUpdateError) throw deptUpdateError;

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
  if (!ctx || !requireSuperAdmin(ctx.requester, res)) return;
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

    const departmentIds = (departments || []).map((d) => d.id);

    // Primary path: centralized departments table with department_id links.
    if (departmentIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('uid, name, username, role, position, is_active, department_id, department')
        .eq('company_id', companyId)
        .in('department_id', departmentIds)
        .order('name', { ascending: true });
      if (usersError) throw usersError;

      const byDepartment = new Map();
      for (const dept of departments) {
        byDepartment.set(dept.id, {
          id: dept.id,
          name: dept.name,
          created_at: dept.created_at,
          employeeCount: 0,
          manager: null,
          employees: [],
        });
      }

      for (const user of users || []) {
        const deptId = user.department_id;
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

router.get('/sites', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    let query = supabase.from('sites').select('*').order('created_at', { ascending: false });
    if (requester.role === ROLES.MANAGER) {
      const managerDept = await getRequesterDepartment(requester, companyId);
      if (!managerDept?.id) return res.status(200).json({ success: true, data: [] });
      query = query.eq('department_id', managerDept.id);
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
  try {
    const payload = { ...req.body };
    if (requester.role === ROLES.MANAGER) {
      const managerDept = await getRequesterDepartment(requester, companyId);
      if (!managerDept?.id) return res.status(400).json({ success: false, error: 'Manager department not mapped' });
      if (payload.department_id !== managerDept.id) {
        return res.status(403).json({ success: false, error: 'Managers can only create sites in their department' });
      }
    } else if (payload.department_id != null) {
      const { data: d } = await supabase
        .from('departments')
        .select('id')
        .eq('id', payload.department_id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (!d) {
        return res.status(400).json({ success: false, error: 'Department not in this tenant' });
      }
    }
    const { data, error } = await supabase.from('sites').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create site' });
  }
});

router.post('/employee-sites', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { employee_uid, site_id } = req.body;
    const { data: employee } = await supabase
      .from('users')
      .select('uid, department, company_id')
      .eq('uid', employee_uid)
      .eq('company_id', companyId)
      .single();
    const { data: site } = await supabase.from('sites').select('id, department_id').eq('id', site_id).single();
    const { data: department } = await supabase
      .from('departments')
      .select('id, name')
      .eq('id', site?.department_id)
      .eq('company_id', companyId)
      .single();
    if (!employee || !site || !department) {
      return res.status(400).json({ success: false, error: 'Invalid employee or site' });
    }
    if (employee.department !== department.name) {
      return res.status(400).json({ success: false, error: 'Cannot assign cross-department employee to site' });
    }
    if (requester.role === ROLES.MANAGER && requester.department !== employee.department) {
      return res.status(403).json({ success: false, error: 'Managers can only assign their department employees' });
    }
    const { data, error } = await supabase.from('employee_sites').insert({ employee_uid, site_id }).select().single();
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
  try {
    const tenantUids = await fetchCompanyUserUids(supabase, companyId);
    const uidFilter = tenantUids.length ? tenantUids : ['00000000-0000-0000-0000-000000000000'];
    let query = supabase.from('attendance_records').select('*').in('user_uid', uidFilter).order('timestamp', { ascending: false });
    if (requester.role === ROLES.MANAGER) {
      const { data: deptUsers } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('department', requester.department);
      const muids = (deptUsers || []).map((u) => u.uid).filter(Boolean);
      const mfilter = muids.length ? muids : ['00000000-0000-0000-0000-000000000000'];
      query = supabase.from('attendance_records').select('*').in('user_uid', mfilter).order('timestamp', { ascending: false });
    }
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch attendance' });
  }
});

router.get('/leaves', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const tenantUids = await fetchCompanyUserUids(supabase, companyId);
    const uidFilter = tenantUids.length ? tenantUids : ['00000000-0000-0000-0000-000000000000'];
    let query = supabase
      .from('leave_requests')
      .select('*')
      .in('employee_uid', uidFilter)
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
        .in('employee_uid', mfilter)
        .order('requested_at', { ascending: false });
    }
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch leaves' });
  }
});

router.patch('/leaves/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    const tenantUids = await fetchCompanyUserUids(supabase, companyId);
    const { data: requestRow } = await supabase
      .from('leave_requests')
      .select('id, employee_uid, status')
      .eq('id', id)
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
    const { error } = await supabase
      .from('leave_requests')
      .update({
        status,
        admin_notes: admin_notes || null,
        processed_at: new Date().toISOString(),
        processed_by: requester.username || requester.email || requester.uid,
      })
      .eq('id', id);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to process leave request' });
  }
});

module.exports = router;
