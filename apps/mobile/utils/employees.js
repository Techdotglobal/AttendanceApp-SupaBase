// Employee management utilities
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';
import { WORK_MODES } from './workModes';
import { resolveCompanyIdFromUser, requireValidCompanyId } from '../core/tenant/tenantScope';
import {
  TENANT_RUNTIME_DIAG,
  tenantDiagLog,
  diagQueryUsersByCompanyId,
} from '../core/debug/tenantRuntimeDiag';

const EMPLOYEES_KEY = 'company_employees';
const WORK_MODE_REQUESTS_KEY = 'work_mode_requests';
const WORK_MODE_HISTORY_KEY = 'work_mode_history';

function mapUserRowToEmployee(emp) {
  return {
    id: `emp_${emp.uid}`,
    uid: emp.uid,
    username: emp.username,
    name: emp.name,
    email: emp.email,
    role: emp.role,
    department: emp.department,
    position: emp.position,
    workMode: emp.work_mode,
    hireDate: emp.hire_date,
    isActive: emp.is_active,
    companyId: emp.company_id != null ? String(emp.company_id) : null,
  };
}

/**
 * Remove legacy AsyncStorage demo employee list so tenant UIs match Supabase.
 */
export const clearLegacyDummyEmployeeCache = async () => {
  try {
    await AsyncStorage.removeItem(EMPLOYEES_KEY);
    tenantDiagLog('employees.clearLegacyDummyEmployeeCache', {
      key: EMPLOYEES_KEY,
      removed: true,
    });
  } catch (error) {
    console.error('clearLegacyDummyEmployeeCache:', error);
  }
};

/**
 * @deprecated Internal diagnostic only — do not call from feature code.
 * Legacy AsyncStorage employee list retained for offline-queue drain only.
 */
const _legacyGetAsyncStorageEmployees = async () => {
  try {
    const employees = await AsyncStorage.getItem(EMPLOYEES_KEY);
    return employees ? JSON.parse(employees) : [];
  } catch (error) {
    console.error('Error getting employees:', error);
    return [];
  }
};

/**
 * Get employees for Calendar event creation - fetches directly from Supabase
 * This is the SINGLE source of truth for Calendar employee selection
 * @param {Object} user - Current user object with role and department
 * @returns {Promise<Array>} Array of employee objects filtered by role and is_active
 */
export const getEmployeesForCalendar = async (user) => {
  try {
    if (!user || !user.role) {
      console.error('getEmployeesForCalendar: Invalid user object');
      return [];
    }

    const companyId = resolveCompanyIdFromUser(user);
    if (!companyId) {
      console.warn('[tenant] getEmployeesForCalendar: missing user.companyId — returning no employees');
      return [];
    }

    // Build query — always tenant-scoped + is_active = true
    let query = supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .eq('is_active', true)
      .eq('company_id', companyId);

    if (__DEV__) {
      console.log('[tenant] getEmployeesForCalendar', { auth_company_id: companyId, role: user.role });
    }

    // Apply role-based filtering (within tenant)
    if (user.role === 'super_admin') {
      // all active users in company
    } else if (user.role === 'manager') {
      query = query.eq('department', user.department);
    } else {
      // employees: same company list for calendar visibility
    }

    const { data: employees, error } = await query.order('name', { ascending: true });

    if (error) {
      console.error('Error fetching employees from Supabase for Calendar:', error);
      return [];
    }

    if (!employees || employees.length === 0) {
      console.log('No active employees found in Supabase for Calendar (tenant-scoped)');
      return [];
    }

    const formattedEmployees = employees.map(mapUserRowToEmployee);

    console.log(
      `✓ Fetched ${formattedEmployees.length} active employee(s) from Supabase for Calendar (tenant ${companyId}, User: ${user.username}, Role: ${user.role}${user.department ? `, Department: ${user.department}` : ''})`
    );
    return formattedEmployees;
  } catch (error) {
    console.error('Error getting employees for Calendar:', error);
    return [];
  }
};

/**
 * Get employee by username (tenant-scoped when companyId is provided)
 * @param {string} username
 * @param {string|null} companyId - required for Supabase isolation; if null, skips DB (returns null)
 */
export const getEmployeeByUsername = async (username, companyId = null) => {
  try {
    const cid = requireValidCompanyId(companyId, 'getEmployeeByUsername');
    if (!cid) {
      if (__DEV__) {
        console.warn('[tenant] getEmployeeByUsername: no valid company_id — returning null');
      }
      return null;
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .eq('username', username)
      .eq('is_active', true)
      .eq('company_id', cid)
      .maybeSingle();

    if (error) {
      console.error('[tenant] getEmployeeByUsername Supabase:', error.message);
      return null;
    }

    if (__DEV__ && user) {
      console.log('[tenant] getEmployeeByUsername hit', { username, queried_company_id: cid, row_company_id: user.company_id });
    }

    if (!user) {
      return null;
    }

    console.log(`✓ Found employee ${username} from Supabase (Department: ${user.department})`);
    return mapUserRowToEmployee(user);
  } catch (error) {
    console.error('Error getting employee by username:', error);
    return null;
  }
};

/**
 * Get employee by ID
 * @param {string} employeeId - Employee ID to search for (can be 'emp_xxx' or just 'xxx' or UID)
 * @param {string|null} companyId - tenant scope for Supabase reads
 * @returns {Promise<Object|null>} Employee object or null
 */
export const getEmployeeById = async (employeeId, companyId = null) => {
  try {
    const cid = requireValidCompanyId(companyId, 'getEmployeeById');
    if (!cid) {
      if (__DEV__) {
        console.warn('[tenant] getEmployeeById: no valid company_id — returning null');
      }
      return null;
    }

    // Extract UID from employeeId (handle formats like 'emp_xxx' or just 'xxx' or full UID)
    let uid = employeeId;
    if (employeeId.startsWith('emp_')) {
      uid = employeeId.replace('emp_', '');
    }

    let { data: user, error } = await supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .eq('uid', uid)
      .eq('is_active', true)
      .eq('company_id', cid)
      .maybeSingle();

    if (error || !user) {
      const second = await supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
        .eq('uid', employeeId)
        .eq('is_active', true)
        .eq('company_id', cid)
        .maybeSingle();

      if (!second.error && second.data) {
        user = second.data;
        error = null;
      } else {
        error = error || second.error;
      }
    }

    if (error) {
      console.error('[tenant] getEmployeeById Supabase:', error.message);
      return null;
    }

    if (__DEV__ && user) {
      console.log('[tenant] getEmployeeById hit', { uid: user.uid, queried_company_id: cid, row_company_id: user.company_id });
    }

    if (!user) {
      return null;
    }

    console.log(`✓ Found employee by ID ${employeeId} from Supabase (Username: ${user.username}, Department: ${user.department})`);
    return mapUserRowToEmployee(user);
  } catch (error) {
    console.error('Error getting employee by ID:', error);
    return null;
  }
};

/**
 * Get all admin users (super_admins and managers only) within one company
 * @param {string} companyId
 */
export const getAdminUsers = async (companyId) => {
  try {
    const cid = requireValidCompanyId(companyId, 'getAdminUsers');
    if (!cid) return [];

    const { data: admins, error } = await supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .in('role', ['manager', 'super_admin'])
      .eq('is_active', true)
      .eq('company_id', cid)
      .order('role', { ascending: false })
      .order('name', { ascending: true });

    if (__DEV__) {
      console.log('[tenant] getAdminUsers', { queried_company_id: cid, count: admins?.length ?? 0 });
    }

    if (error) {
      console.error('[tenant] getAdminUsers Supabase:', error.message);
      return [];
    }

    return (admins || []).map(mapUserRowToEmployee);
  } catch (error) {
    console.error('Error getting admin users:', error);
    return [];
  }
};

/**
 * Get super admin users only (within company)
 * @param {string} companyId
 */
export const getSuperAdminUsers = async (companyId) => {
  try {
    const cid = requireValidCompanyId(companyId, 'getSuperAdminUsers');
    if (!cid) return [];

    const { data: superAdmins, error } = await supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .eq('role', 'super_admin')
      .eq('is_active', true)
      .eq('company_id', cid);

    if (__DEV__) {
      console.log('[tenant] getSuperAdminUsers', { queried_company_id: cid, count: superAdmins?.length ?? 0 });
    }

    if (error) {
      console.error('[tenant] getSuperAdminUsers Supabase:', error.message);
      return [];
    }

    return (superAdmins || []).map(mapUserRowToEmployee);
  } catch (error) {
    console.error('Error getting super admin users:', error);
    return [];
  }
};

/**
 * Get managers for a specific department (within company)
 * @param {string} department - Department name
 * @param {string} companyId
 */
export const getManagersByDepartment = async (department, companyId) => {
  try {
    const cid = requireValidCompanyId(companyId, 'getManagersByDepartment');
    if (!cid) return [];

    const { data: managers, error } = await supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .eq('role', 'manager')
      .eq('department', department)
      .eq('is_active', true)
      .eq('company_id', cid);

    if (__DEV__) {
      console.log('[tenant] getManagersByDepartment', { department, queried_company_id: cid, count: managers?.length ?? 0 });
    }

    if (error) {
      console.error('[tenant] getManagersByDepartment Supabase:', error.message);
      return [];
    }

    const list = (managers || []).map(mapUserRowToEmployee);
    if (list.length === 0) {
      console.warn(`⚠️ No managers found for department: ${department}`);
    }
    return list;
  } catch (error) {
    console.error('Error getting managers by department:', error);
    return [];
  }
};

/**
 * Check if user is HR manager (special privileges)
 * @deprecated Use isHRAdmin from shared/constants/roles.js instead
 * @param {Object} user - User object with role and department
 * @returns {boolean} Whether user is HR manager
 */
export const isHRManager = (user) => {
  return user && user.role === 'manager' && user.department === 'HR';
};

/**
 * Get employees that a user can manage
 * @param {Object} user - User object with role and department
 * @returns {Promise<Array>} Array of employees the user can manage
 */
export const getManageableEmployees = async (user) => {
  try {
    tenantDiagLog('getManageableEmployees.incoming', {
      buildMarker: 'diag_instrumented_getManageableEmployees_v1',
      user: user
        ? {
            uid: user.uid,
            username: user.username,
            role: user.role,
            companyId: user.companyId ?? user.company_id,
            department: user.department,
          }
        : null,
    });

    const companyId = resolveCompanyIdFromUser(user);
    if (!companyId) {
      console.warn('[tenant] getManageableEmployees: missing user.companyId — returning empty list');
      tenantDiagLog('getManageableEmployees.aborted', {
        reason: 'resolveCompanyIdFromUser_returned_null',
        rawCompanyId: user?.companyId ?? user?.company_id,
      });
      return [];
    }

    // First, try to get from Supabase (source of truth)
    try {
      let query = supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
        .eq('is_active', true)
        .eq('company_id', companyId);

      const queryFilters = {
        is_active: true,
        company_id: companyId,
        viewer_role: user.role,
        viewer_department: user.department ?? null,
      };

      if (__DEV__) {
        console.log('[tenant] getManageableEmployees', { auth_company_id: companyId, role: user.role });
      }

      // Super admins can manage EVERYONE (including other super admins) within tenant
      if (user.role === 'super_admin') {
        queryFilters.role_branch = 'super_admin_all_in_company';
      } else if (user.role === 'manager' && user.department === 'HR') {
        query = query.neq('role', 'super_admin');
        queryFilters.role_branch = 'hr_manager_exclude_super_admin';
      } else if (user.role === 'manager') {
        query = query
          .eq('department', user.department)
          .neq('role', 'super_admin')
          .neq('role', 'manager');
        queryFilters.role_branch = 'manager_same_dept_non_manager_roles';
      } else {
        tenantDiagLog('getManageableEmployees.aborted', { reason: 'viewer_role_not_manager_or_super_admin' });
        return [];
      }

      query = query.order('name', { ascending: true });

      const { data: employees, error } = await query;

      if (error) {
        console.error('Error fetching manageable employees from Supabase:', error);
        tenantDiagLog('getManageableEmployees.supabase_error', {
          message: error.message,
          code: error.code,
          queryFilters,
        });
        throw error;
      }

      const formattedEmployees = (employees || []).map(mapUserRowToEmployee);

      tenantDiagLog('getManageableEmployees.supabase_result', {
        queryFilters,
        totalRows: formattedEmployees.length,
        usernames: formattedEmployees.map((e) => e.username),
        company_ids: [...new Set((employees || []).map((r) => String(r.company_id ?? '')))],
        is_active_values: [...new Set((employees || []).map((r) => r.is_active))],
      });

      if (TENANT_RUNTIME_DIAG) {
        await diagQueryUsersByCompanyId(companyId, 'rls_all_rows_company_id_match');

        const { data: broadActive, error: broadErr } = await supabase
          .from('users')
          .select('username, role, is_active, company_id, department')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('username', { ascending: true });

        const manageableSet = new Set(formattedEmployees.map((e) => e.username));
        const broadList = broadActive || [];
        const excludedFromManageable = broadList.filter((r) => !manageableSet.has(r.username));
        const inManageableNotBroad = formattedEmployees.filter(
          (e) => !broadList.some((r) => r.username === e.username)
        );

        tenantDiagLog('getManageableEmployees.vs_broad_active_same_company', {
          broadError: broadErr?.message || null,
          broadCount: broadList.length,
          broadUsernames: broadList.map((r) => r.username),
          manageableCount: formattedEmployees.length,
          excludedFromManageableByRoleOrDept: excludedFromManageable.map((r) => ({
            username: r.username,
            role: r.role,
            department: r.department,
            is_active: r.is_active,
          })),
          inManageableNotInBroad: inManageableNotBroad.map((e) => e.username),
        });

        try {
          const legacy = await _legacyGetAsyncStorageEmployees();
          tenantDiagLog('getManageableEmployees.asyncstorage_company_employees', {
            key: EMPLOYEES_KEY,
            count: legacy.length,
            usernames: legacy.map((e) => e.username).slice(0, 40),
          });
        } catch (e) {
          tenantDiagLog('getManageableEmployees.asyncstorage_read_error', { message: e?.message || String(e) });
        }
      }

      console.log(
        `✓ Found ${formattedEmployees.length} manageable employee(s) from Supabase for ${user.username} (${user.role}, tenant ${companyId})`
      );

      if (formattedEmployees.length > 0) {
        return formattedEmployees;
      }

      console.warn(
        `⚠️ No manageable employees found in Supabase for ${user.username} (${user.role}, ${user.department || 'N/A'})`
      );
      tenantDiagLog('getManageableEmployees.empty_manageable_list', { queryFilters });
      return [];
    } catch (supabaseError) {
      console.log('Could not get employees from Supabase:', supabaseError.message);
      tenantDiagLog('getManageableEmployees.catch', { message: supabaseError?.message || String(supabaseError) });
    }

    // AsyncStorage fallback is not tenant-isolated; skip when using real multi-tenant auth
    return [];
  } catch (error) {
    console.error('Error getting manageable employees:', error);
    return [];
  }
};

/**
 * Check if a user can manage a specific employee
 * @param {Object} user - User object with role and department
 * @param {Object} employee - Employee to check
 * @returns {boolean} Whether the user can manage the employee
 */
export const canManageEmployee = (user, employee) => {
  if (!user || !employee) return false;

  const uc = resolveCompanyIdFromUser(user);
  const ec = employee.companyId ?? employee.company_id;
  if (uc && ec && String(uc) !== String(ec)) {
    return false;
  }

  // Super admins can manage everyone in tenant
  if (user.role === 'super_admin') {
    return true;
  }

  // HR managers can manage all employees (special case)
  if (user.role === 'manager' && user.department === 'HR') {
    return employee.role !== 'super_admin';
  }

  // Other managers can only manage employees (non-manager, non-super_admin) in their department
  if (user.role === 'manager') {
    return (
      employee.department === user.department &&
      employee.role !== 'super_admin' &&
      employee.role !== 'manager'
    );
  }

  return false;
};

/**
 * Update employee work mode in Supabase
 * @param {string} employeeId - Employee ID (can be 'emp_xxx', uid, or username)
 * @param {string} newWorkMode - New work mode
 * @param {Object} updaterUser - User object making the change (for permission checks)
 * @returns {Promise<{success: boolean, error?: string, data?: Object}>} Success status with updated data
 */
export const updateEmployeeWorkMode = async (employeeId, newWorkMode, updaterUser) => {
  try {
    // Validate work mode
    const validModes = ['in_office', 'semi_remote', 'fully_remote'];
    if (!validModes.includes(newWorkMode)) {
      return { success: false, error: 'Invalid work mode' };
    }

    // Validate updater user
    if (!updaterUser || !updaterUser.role) {
      return { success: false, error: 'Invalid updater user' };
    }

    // Get the target employee from Supabase
    let targetEmployee = null;
    let targetUid = null;
    
    // Try to get by employeeId (could be 'emp_xxx', uid, or username)
    const viewerCompany = resolveCompanyIdFromUser(updaterUser);
    if (!viewerCompany) {
      return { success: false, error: 'Missing tenant context (company_id)' };
    }

    if (employeeId.startsWith('emp_')) {
      const uid = employeeId.replace('emp_', '');
      targetEmployee = await getEmployeeById(uid, viewerCompany);
      targetUid = uid;
    } else {
      // Try as UID first
      targetEmployee = await getEmployeeById(employeeId, viewerCompany);
      if (targetEmployee) {
        targetUid = targetEmployee.uid || employeeId;
      } else {
        // If not found, try as username
        targetEmployee = await getEmployeeByUsername(employeeId, viewerCompany);
        if (targetEmployee) {
          targetUid = targetEmployee.uid;
        }
      }
    }

    if (!targetEmployee || !targetUid) {
      return { success: false, error: 'Employee not found' };
    }

    // Permission checks BEFORE updating
    // 1. Block if target is super_admin and updater is not super_admin
    if (targetEmployee.role === 'super_admin' && updaterUser.role !== 'super_admin') {
      return { success: false, error: 'Permission denied: Cannot modify super admin accounts' };
    }

    // 2. Check if updater can manage this employee
    if (!canManageEmployee(updaterUser, targetEmployee)) {
      // Provide specific error message based on updater role
      if (updaterUser.role === 'manager' && updaterUser.department !== 'HR') {
        return { success: false, error: 'Permission denied: You can only manage employees in your department' };
      } else if (updaterUser.role === 'manager' && updaterUser.department === 'HR') {
        return { success: false, error: 'Permission denied: HR managers cannot modify super admin accounts' };
      } else {
        return { success: false, error: 'Permission denied: You do not have permission to manage this employee' };
      }
    }

    if (String(targetEmployee.companyId || '') !== String(viewerCompany)) {
      return { success: false, error: 'Permission denied: employee belongs to another tenant' };
    }

    // Get old work mode for history
    const oldWorkMode = targetEmployee.workMode || targetEmployee.work_mode;

    // Update directly in Supabase using UID (most reliable identifier)
    // This ensures RLS policies are properly enforced
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        work_mode: newWorkMode,
        updated_at: new Date().toISOString(),
      })
      .eq('uid', targetUid)
      .eq('company_id', viewerCompany)
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active, company_id')
      .single();

    if (updateError) {
      console.error('Supabase update error:', updateError);
      // Check if it's a permission error (RLS policy violation)
      if (updateError.code === '42501' || updateError.message?.includes('permission') || updateError.message?.includes('policy')) {
        return { success: false, error: 'Permission denied: You do not have permission to update this employee\'s work mode' };
      }
      return { success: false, error: updateError.message || 'Failed to update work mode in database' };
    }

    if (!updatedUser) {
      return { success: false, error: 'Update succeeded but no data returned' };
    }

    // Add to work mode history (local tracking)
    await addWorkModeHistory(
      targetEmployee.id || targetEmployee.uid || targetUid, 
      oldWorkMode, 
      newWorkMode, 
      updaterUser.username || updaterUser.name || 'Unknown'
    );

    console.log(`✓ Work mode updated for ${targetEmployee.name} (${targetEmployee.username}): ${oldWorkMode} → ${newWorkMode}`);
    console.log(`  Updated by: ${updaterUser.username} (${updaterUser.role}${updaterUser.department ? `, ${updaterUser.department}` : ''})`);
    
    return { 
      success: true, 
      data: {
        ...updatedUser,
        workMode: updatedUser.work_mode, // Convert to camelCase for frontend
        id: `emp_${updatedUser.uid}` // Maintain compatibility
      }
    };
  } catch (error) {
    console.error('Error updating employee work mode:', error);
    return { success: false, error: error.message || 'Failed to update work mode' };
  }
};

/**
 * Add work mode change to history
 * @param {string} employeeId - Employee ID
 * @param {string} fromMode - Previous work mode
 * @param {string} toMode - New work mode
 * @param {string} changedBy - Username who made the change
 */
export const addWorkModeHistory = async (employeeId, fromMode, toMode, changedBy) => {
  try {
    const history = await getWorkModeHistory();
    const historyEntry = {
      id: Date.now().toString(),
      employeeId,
      fromMode,
      toMode,
      changedBy,
      timestamp: new Date().toISOString()
    };
    
    history.push(historyEntry);
    await AsyncStorage.setItem(WORK_MODE_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('Error adding work mode history:', error);
  }
};

/**
 * Get work mode history
 * @returns {Promise<Array>} Array of work mode change records
 */
export const getWorkModeHistory = async () => {
  try {
    const history = await AsyncStorage.getItem(WORK_MODE_HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch (error) {
    console.error('Error getting work mode history:', error);
    return [];
  }
};

/**
 * Get work mode history for specific employee
 * @param {string} employeeId - Employee ID
 * @returns {Promise<Array>} Array of work mode changes for employee
 */
export const getEmployeeWorkModeHistory = async (employeeId) => {
  try {
    const history = await getWorkModeHistory();
    return history.filter(entry => entry.employeeId === employeeId);
  } catch (error) {
    console.error('Error getting employee work mode history:', error);
    return [];
  }
};

/**
 * Create work mode change request
 * @param {string} employeeId - Employee ID
 * @param {string} requestedMode - Requested work mode
 * @param {string} reason - Reason for request
 * @returns {Promise<boolean>} Success status
 */
export const createWorkModeRequest = async (employeeId, requestedMode, reason) => {
  try {
    const requests = await getWorkModeRequests();
    const request = {
      id: Date.now().toString(),
      employeeId,
      requestedMode,
      currentMode: null, // Will be filled when processing
      reason,
      status: 'pending', // pending, approved, rejected
      requestedAt: new Date().toISOString(),
      processedAt: null,
      processedBy: null,
      adminNotes: null
    };
    
    requests.push(request);
    await AsyncStorage.setItem(WORK_MODE_REQUESTS_KEY, JSON.stringify(requests));
    
    console.log(`Work mode request created for employee ${employeeId}: ${requestedMode}`);
    return true;
  } catch (error) {
    console.error('Error creating work mode request:', error);
    return false;
  }
};

/**
 * Get all work mode requests
 * @returns {Promise<Array>} Array of work mode requests
 */
export const getWorkModeRequests = async () => {
  try {
    const requests = await AsyncStorage.getItem(WORK_MODE_REQUESTS_KEY);
    return requests ? JSON.parse(requests) : [];
  } catch (error) {
    console.error('Error getting work mode requests:', error);
    return [];
  }
};

/**
 * Get pending work mode requests
 * @returns {Promise<Array>} Array of pending requests
 */
export const getPendingWorkModeRequests = async () => {
  try {
    const requests = await getWorkModeRequests();
    return requests.filter(request => request.status === 'pending');
  } catch (error) {
    console.error('Error getting pending work mode requests:', error);
    return [];
  }
};

/**
 * Process work mode request (approve or reject)
 * @param {string} requestId - Request ID
 * @param {string} status - 'approved' or 'rejected'
 * @param {string} processedBy - Username of admin who processed
 * @param {string} adminNotes - Admin notes
 * @returns {Promise<boolean>} Success status
 */
export const processWorkModeRequest = async (requestId, status, processedBy, adminNotes = '', companyId = null) => {
  try {
    const requests = await getWorkModeRequests();
    const requestIndex = requests.findIndex(req => req.id === requestId);
    
    if (requestIndex === -1) {
      throw new Error('Request not found');
    }
    
    const request = requests[requestIndex];
    request.status = status;
    request.processedAt = new Date().toISOString();
    request.processedBy = processedBy;
    request.adminNotes = adminNotes;
    
    // If approved, update employee work mode
    if (status === 'approved') {
      // processedBy is a username; request.employeeId is emp_<uid> format.
      const processingUser = await getEmployeeByUsername(processedBy, companyId);
      if (processingUser) {
        // EMP-3: employeeId is stored as emp_<uid>, not a username — use getEmployeeById.
        const employee = await getEmployeeById(request.employeeId, companyId);
        if (employee) {
          const result = await updateEmployeeWorkMode(
            employee.id || employee.uid,
            request.requestedMode,
            processingUser
          );
          if (!result.success) {
            console.error('Failed to update work mode:', result.error);
          }
        }
      }
    }
    
    await AsyncStorage.setItem(WORK_MODE_REQUESTS_KEY, JSON.stringify(requests));
    
    console.log(`Work mode request ${requestId} ${status} by ${processedBy}`);
    return true;
  } catch (error) {
    console.error('Error processing work mode request:', error);
    return false;
  }
};

/**
 * Get work mode statistics for employees the user can manage (Supabase-backed).
 * @param {Object|null} user - Auth user with companyId and role; if omitted, returns zeros.
 * @returns {Promise<Object>} Statistics object
 */
export const getWorkModeStatistics = async (user = null) => {
  try {
    const companyId = user ? resolveCompanyIdFromUser(user) : null;
    const employees =
      companyId && (user.role === 'super_admin' || user.role === 'manager')
        ? await getManageableEmployees(user)
        : [];
    const stats = {
      total: employees.length,
      inOffice: 0,
      semiRemote: 0,
      fullyRemote: 0
    };
    
    employees.forEach(emp => {
      switch (emp.workMode) {
        case WORK_MODES.IN_OFFICE:
          stats.inOffice++;
          break;
        case WORK_MODES.SEMI_REMOTE:
          stats.semiRemote++;
          break;
        case WORK_MODES.FULLY_REMOTE:
          stats.fullyRemote++;
          break;
      }
    });
    
    return stats;
  } catch (error) {
    console.error('Error getting work mode statistics:', error);
    return { total: 0, inOffice: 0, semiRemote: 0, fullyRemote: 0 };
  }
};

/**
 * Create a new employee
 * @param {Object} employeeData - Employee data
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export const createEmployee = async (employeeData) => {
  try {
    const {
      username,
      password,
      name,
      email,
      role = 'employee',
      department = '',
      position = '',
      workMode = WORK_MODES.IN_OFFICE,
      hireDate = new Date().toISOString().split('T')[0],
      companyId,
      company_id,
      requester,
    } = employeeData;

    // Validate required fields
    if (!username || !password || !name || !email) {
      return { success: false, error: 'Username, password, name, and email are required' };
    }

    const tenantId = companyId ?? company_id ?? requester?.companyId ?? requester?.company_id;
    const existingEmployee = await getEmployeeByUsername(username, tenantId);
    if (existingEmployee) {
      return { success: false, error: 'Username already exists' };
    }

    // Check if username exists in Supabase
    const { checkUsernameExists, addUserToFile } = await import('./auth');
    const usernameExists = await checkUsernameExists(username);
    if (usernameExists) {
      return { success: false, error: 'Username already exists in system' };
    }

    const { normalizeDepartmentDisplay, normalizePositionDisplay } = await import('./orgNormalize');

    const addUserResult = await addUserToFile({
      username,
      password,
      email,
      name,
      role,
      department: normalizeDepartmentDisplay(department),
      position: normalizePositionDisplay(position),
      workMode,
      hireDate,
      requester,
    });

    if (!addUserResult.success) {
      return { success: false, error: addUserResult.error || 'Failed to create user account' };
    }

    const uid = addUserResult.uid;
    console.log('✓ Employee created in Supabase:', uid);
    return { success: true, id: uid ? `emp_${uid}` : undefined, uid };
  } catch (error) {
    console.error('Error creating employee:', error);
    return { success: false, error: error.message || 'Failed to create employee' };
  }
};

/**
 * Update employee information (including role). Source of truth: public.users via gateway.
 * @param {string} employeeId - Employee ID (may have 'emp_' prefix)
 * @param {Object} updates - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateEmployee = async (employeeId, updates) => {
  try {
    const uid = typeof employeeId === 'string' && employeeId.startsWith('emp_')
      ? employeeId.slice(4)
      : employeeId;

    const { data: userRow, error: lookupError } = await supabase
      .from('users')
      .select('username, role')
      .eq('uid', uid)
      .maybeSingle();

    if (lookupError || !userRow) {
      console.error('[employees] updateEmployee: lookup failed', { uid, error: lookupError?.message });
      return { success: false, error: 'Employee not found' };
    }

    const { updateUserRole, updateUserInfo } = await import('./auth');

    if (updates.role !== undefined && updates.role !== userRow.role) {
      const result = await updateUserRole(userRow.username, updates.role);
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to update role' };
      }
    }

    const { role: _role, ...nonRoleUpdates } = updates;
    if (Object.keys(nonRoleUpdates).length > 0) {
      const result = await updateUserInfo(userRow.username, nonRoleUpdates);
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to update employee info' };
      }
    }

    console.log('✓ Employee updated via gateway:', uid, Object.keys(updates));
    return { success: true };
  } catch (error) {
    console.error('Error updating employee:', error);
    return { success: false, error: error.message || 'Failed to update employee' };
  }
};

/**
 * Soft-delete employee — sets is_active = false in public.users.
 * @param {string} employeeId - Employee ID (may have 'emp_' prefix)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteEmployee = async (employeeId) => {
  try {
    const uid = typeof employeeId === 'string' && employeeId.startsWith('emp_')
      ? employeeId.slice(4)
      : employeeId;

    const { error } = await supabase
      .from('users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('uid', uid);

    if (error) {
      console.error('[employees] deleteEmployee Supabase:', error.message);
      return { success: false, error: error.message || 'Failed to deactivate employee' };
    }

    console.log('✓ Employee deactivated:', uid);
    return { success: true };
  } catch (error) {
    console.error('Error deactivating employee:', error);
    return { success: false, error: error.message || 'Failed to deactivate employee' };
  }
};
