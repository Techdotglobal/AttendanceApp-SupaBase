// Leave Management Utilities using Supabase
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';
import { createNotification, createBatchNotifications } from './notifications';
import { getEmployeeById, getAdminUsers, getSuperAdminUsers, getManagersByDepartment } from './employees';
import { fetchSessionUserCompanyId, fetchCompanyUserUids, requireValidCompanyId } from '../core/tenant/tenantScope';

const LEAVE_SETTINGS_KEY = 'leave_settings';
const EMPLOYEE_LEAVES_KEY = 'employee_leaves';
const LEAVE_REQUESTS_KEY = 'leave_requests';

// Leave Request Categories (same as ticket categories for routing)
export const LEAVE_CATEGORIES = {
  ENGINEERING: 'engineering',
  TECHNICAL: 'technical',
  HR: 'hr',
  FINANCE: 'finance',
  SALES: 'sales',
  FACILITIES: 'facilities',
  OTHER: 'other'
};

// Map leave categories to departments (same as tickets)
// Engineering and Technical are separate departments with separate managers
const CATEGORY_TO_DEPARTMENT_MAP = {
  [LEAVE_CATEGORIES.ENGINEERING]: 'Engineering', // Routes to Engineering Manager
  [LEAVE_CATEGORIES.TECHNICAL]: 'Technical',     // Routes to Technical Manager (separate department)
  [LEAVE_CATEGORIES.HR]: 'HR',
  [LEAVE_CATEGORIES.FINANCE]: 'Finance',
  [LEAVE_CATEGORIES.SALES]: 'Sales',
  [LEAVE_CATEGORIES.FACILITIES]: 'Facilities',
  [LEAVE_CATEGORIES.OTHER]: null // No specific department, goes to super_admin only
};

// Category Labels
export const getCategoryLabel = (category) => {
  const labels = {
    [LEAVE_CATEGORIES.ENGINEERING]: 'Engineering',
    [LEAVE_CATEGORIES.TECHNICAL]: 'Technical',
    [LEAVE_CATEGORIES.HR]: 'HR',
    [LEAVE_CATEGORIES.FINANCE]: 'Finance',
    [LEAVE_CATEGORIES.SALES]: 'Sales',
    [LEAVE_CATEGORIES.FACILITIES]: 'Facilities',
    [LEAVE_CATEGORIES.OTHER]: 'Other'
  };
  return labels[category] || category;
};

const LEAVE_SETTINGS_DEFAULTS = {
  defaultAnnualLeaves: 20,
  defaultSickLeaves: 10,
  defaultCasualLeaves: 5,
  leaveYearStart: '01-01',
  leaveYearEnd: '12-31',
};

function _dbRowToLeaveSettings(row) {
  return {
    defaultAnnualLeaves: row.default_annual_leaves,
    defaultSickLeaves: row.default_sick_leaves,
    defaultCasualLeaves: row.default_casual_leaves,
    leaveYearStart: row.leave_year_start,
    leaveYearEnd: row.leave_year_end,
    updatedAt: row.updated_at,
  };
}

/**
 * Get default leave settings for the current user's company from Supabase.
 * @returns {Promise<Object>} Default leave settings
 */
export const getDefaultLeaveSettings = async () => {
  try {
    const companyId = await fetchSessionUserCompanyId();
    if (!companyId) {
      console.warn('[leave] getDefaultLeaveSettings: no company_id in session — returning defaults');
      return { ...LEAVE_SETTINGS_DEFAULTS, updatedAt: null };
    }
    const { data, error } = await supabase
      .from('leave_settings')
      .select('default_annual_leaves, default_sick_leaves, default_casual_leaves, leave_year_start, leave_year_end, updated_at')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) {
      console.error('[leave] getDefaultLeaveSettings Supabase error:', error.message);
      return { ...LEAVE_SETTINGS_DEFAULTS, updatedAt: null };
    }
    if (!data) return { ...LEAVE_SETTINGS_DEFAULTS, updatedAt: null };
    return _dbRowToLeaveSettings(data);
  } catch (error) {
    console.error('[leave] getDefaultLeaveSettings:', error);
    return { ...LEAVE_SETTINGS_DEFAULTS, updatedAt: null };
  }
};

/**
 * Update (upsert) default leave settings for the current user's company.
 * @param {Object} settings - Leave settings object
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateDefaultLeaveSettings = async (settings) => {
  try {
    const companyId = await fetchSessionUserCompanyId();
    if (!companyId) {
      return { success: false, error: 'No active company session.' };
    }
    const { error } = await supabase
      .from('leave_settings')
      .upsert(
        {
          company_id: companyId,
          default_annual_leaves: settings.defaultAnnualLeaves ?? LEAVE_SETTINGS_DEFAULTS.defaultAnnualLeaves,
          default_sick_leaves: settings.defaultSickLeaves ?? LEAVE_SETTINGS_DEFAULTS.defaultSickLeaves,
          default_casual_leaves: settings.defaultCasualLeaves ?? LEAVE_SETTINGS_DEFAULTS.defaultCasualLeaves,
          leave_year_start: settings.leaveYearStart ?? LEAVE_SETTINGS_DEFAULTS.leaveYearStart,
          leave_year_end: settings.leaveYearEnd ?? LEAVE_SETTINGS_DEFAULTS.leaveYearEnd,
        },
        { onConflict: 'company_id' }
      );
    if (error) {
      console.error('[leave] updateDefaultLeaveSettings Supabase error:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    console.error('[leave] updateDefaultLeaveSettings:', error);
    return { success: false, error: error.message || 'Failed to update default leave settings' };
  }
};

/**
 * Get employee leave balance from Supabase leave_balances table.
 * Falls back to company defaults when no custom row exists.
 * Used leaves are always computed from approved leave_requests (source of truth).
 * @param {string} employeeId - emp_<uid> or raw uid
 * @returns {Promise<Object>} Employee leave balance
 */
export const getEmployeeLeaveBalance = async (employeeId) => {
  const uid = typeof employeeId === 'string' && employeeId.startsWith('emp_')
    ? employeeId.slice(4)
    : employeeId;
  try {
    const defaultSettings = await getDefaultLeaveSettings();

    // Read allocation from leave_balances (may not exist → use company defaults)
    const { data: balanceRow, error: balanceError } = await supabase
      .from('leave_balances')
      .select('annual_leaves, sick_leaves, casual_leaves, is_custom, company_id, created_at, updated_at')
      .eq('user_uid', uid)
      .maybeSingle();

    if (balanceError) {
      console.error('[leave] getEmployeeLeaveBalance balances query:', balanceError.message);
    }

    const baseBalance = {
      employeeId,
      annualLeaves: balanceRow?.annual_leaves ?? defaultSettings.defaultAnnualLeaves,
      sickLeaves: balanceRow?.sick_leaves ?? defaultSettings.defaultSickLeaves,
      casualLeaves: balanceRow?.casual_leaves ?? defaultSettings.defaultCasualLeaves,
      usedAnnualLeaves: 0,
      usedSickLeaves: 0,
      usedCasualLeaves: 0,
      isCustom: balanceRow?.is_custom ?? false,
      createdAt: balanceRow?.created_at ?? new Date().toISOString(),
      updatedAt: balanceRow?.updated_at ?? null,
    };

    // Calculate used leaves from approved leave_requests (authoritative)
    const { data: approvedRequests, error: reqError } = await supabase
      .from('leave_requests')
      .select('leave_type, days')
      .eq('employee_uid', uid)
      .eq('status', 'approved');

    if (reqError) {
      console.error('[leave] getEmployeeLeaveBalance requests query:', reqError.message);
      return baseBalance;
    }

    let usedAnnual = 0, usedSick = 0, usedCasual = 0;
    (approvedRequests || []).forEach((req) => {
      const days = parseFloat(req.days) || 0;
      if (req.leave_type === 'annual') usedAnnual += days;
      else if (req.leave_type === 'sick') usedSick += days;
      else if (req.leave_type === 'casual') usedCasual += days;
    });

    return {
      ...baseBalance,
      usedAnnualLeaves: usedAnnual,
      usedSickLeaves: usedSick,
      usedCasualLeaves: usedCasual,
    };
  } catch (error) {
    console.error('[leave] getEmployeeLeaveBalance:', error);
    const defaultSettings = await getDefaultLeaveSettings();
    return {
      employeeId,
      annualLeaves: defaultSettings.defaultAnnualLeaves,
      sickLeaves: defaultSettings.defaultSickLeaves,
      casualLeaves: defaultSettings.defaultCasualLeaves,
      usedAnnualLeaves: 0,
      usedSickLeaves: 0,
      usedCasualLeaves: 0,
      isCustom: false,
    };
  }
};

/**
 * Upsert employee leave balance into Supabase leave_balances table.
 * @param {string} employeeId - emp_<uid> or raw uid
 * @param {Object} leaveData - Leave balance data
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateEmployeeLeaveBalance = async (employeeId, leaveData) => {
  const uid = typeof employeeId === 'string' && employeeId.startsWith('emp_')
    ? employeeId.slice(4)
    : employeeId;
  try {
    const companyId = await fetchSessionUserCompanyId();
    if (!companyId) {
      return { success: false, error: 'No active company session.' };
    }
    const existing = await getEmployeeLeaveBalance(employeeId);
    const { error } = await supabase
      .from('leave_balances')
      .upsert(
        {
          user_uid: uid,
          company_id: companyId,
          annual_leaves: leaveData.annualLeaves ?? existing.annualLeaves,
          sick_leaves: leaveData.sickLeaves ?? existing.sickLeaves,
          casual_leaves: leaveData.casualLeaves ?? existing.casualLeaves,
          is_custom: true,
        },
        { onConflict: 'user_uid' }
      );
    if (error) {
      console.error('[leave] updateEmployeeLeaveBalance Supabase error:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    console.error('[leave] updateEmployeeLeaveBalance:', error);
    return {
      success: false,
      error: error.message || 'Failed to update employee leave balance'
    };
  }
};

/**
 * Reset employee leave balance to company defaults (sets is_custom=false).
 * @param {string} employeeId - emp_<uid> or raw uid
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const resetEmployeeLeaveToDefault = async (employeeId) => {
  const uid = typeof employeeId === 'string' && employeeId.startsWith('emp_')
    ? employeeId.slice(4)
    : employeeId;
  try {
    const companyId = await fetchSessionUserCompanyId();
    if (!companyId) {
      return { success: false, error: 'No active company session.' };
    }
    const defaultSettings = await getDefaultLeaveSettings();
    const { error } = await supabase
      .from('leave_balances')
      .upsert(
        {
          user_uid: uid,
          company_id: companyId,
          annual_leaves: defaultSettings.defaultAnnualLeaves,
          sick_leaves: defaultSettings.defaultSickLeaves,
          casual_leaves: defaultSettings.defaultCasualLeaves,
          is_custom: false,
        },
        { onConflict: 'user_uid' }
      );
    if (error) {
      console.error('[leave] resetEmployeeLeaveToDefault Supabase error:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    console.error('[leave] resetEmployeeLeaveToDefault:', error);
    return { success: false, error: error.message || 'Failed to reset employee leave balance' };
  }
};

/**
 * Get all employees' leave balances for the current user's company from Supabase.
 * @returns {Promise<Array>} Array of employee leave balances
 */
export const getAllEmployeesLeaveBalances = async () => {
  try {
    const companyId = await fetchSessionUserCompanyId();
    if (!companyId) {
      console.warn('[leave] getAllEmployeesLeaveBalances: no company_id in session');
      return [];
    }
    const { data, error } = await supabase
      .from('leave_balances')
      .select('user_uid, annual_leaves, sick_leaves, casual_leaves, is_custom, created_at, updated_at')
      .eq('company_id', companyId);
    if (error) {
      console.error('[leave] getAllEmployeesLeaveBalances Supabase error:', error.message);
      return [];
    }
    return (data || []).map((row) => ({
      id: `emp_${row.user_uid}`,
      employeeId: `emp_${row.user_uid}`,
      annualLeaves: row.annual_leaves,
      sickLeaves: row.sick_leaves,
      casualLeaves: row.casual_leaves,
      isCustom: row.is_custom,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    console.error('[leave] getAllEmployeesLeaveBalances:', error);
    return [];
  }
};

/**
 * Calculate remaining leaves
 * @param {Object} leaveBalance - Leave balance object
 * @returns {Object} Remaining leaves for each type
 */
export const calculateRemainingLeaves = (leaveBalance) => {
  return {
    annual: Math.max(0, (leaveBalance.annualLeaves || 0) - (leaveBalance.usedAnnualLeaves || 0)),
    sick: Math.max(0, (leaveBalance.sickLeaves || 0) - (leaveBalance.usedSickLeaves || 0)),
    casual: Math.max(0, (leaveBalance.casualLeaves || 0) - (leaveBalance.usedCasualLeaves || 0)),
    total: Math.max(0, 
      ((leaveBalance.annualLeaves || 0) + (leaveBalance.sickLeaves || 0) + (leaveBalance.casualLeaves || 0)) -
      ((leaveBalance.usedAnnualLeaves || 0) + (leaveBalance.usedSickLeaves || 0) + (leaveBalance.usedCasualLeaves || 0))
    )
  };
};

/**
 * Create a leave request
 * @param {string} employeeId - Employee ID
 * @param {string} leaveType - Type of leave: 'annual', 'sick', 'casual'
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} reason - Reason for leave
 * @param {boolean} isHalfDay - Whether this is a half-day leave (default: false)
 * @param {string} halfDayPeriod - For half-day: 'morning' or 'afternoon' (optional)
 * @param {string} category - Category for routing: 'engineering', 'technical', 'hr', 'finance', 'sales', 'facilities', 'other' (optional, defaults to employee's department)
 * @returns {Promise<{success: boolean, requestId?: string, error?: string}>}
 */
export const createLeaveRequest = async (employeeId, leaveType, startDate, endDate, reason = '', isHalfDay = false, halfDayPeriod = null, category = null) => {
  try {
    // Validate leave type
    const validTypes = ['annual', 'sick', 'casual'];
    if (!validTypes.includes(leaveType)) {
      return {
        success: false,
        error: 'Invalid leave type. Must be: annual, sick, or casual'
      };
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return {
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      };
    }

    // For half-day leave, start and end date must be the same
    if (isHalfDay && startDate !== endDate) {
      return {
        success: false,
        error: 'Half-day leave must be for a single day only'
      };
    }

    if (start > end) {
      return {
        success: false,
        error: 'Start date must be before or equal to end date'
      };
    }

    // Calculate number of days (excluding weekends)
    let days;
    if (isHalfDay) {
      days = 0.5; // Half day
    } else {
      days = calculateWorkingDays(start, end);
    }

    // Check if employee has enough leaves
    const leaveBalance = await getEmployeeLeaveBalance(employeeId);
    const remaining = calculateRemainingLeaves(leaveBalance);
    
    let availableLeaves = 0;
    if (leaveType === 'annual') {
      availableLeaves = remaining.annual;
    } else if (leaveType === 'sick') {
      availableLeaves = remaining.sick;
    } else if (leaveType === 'casual') {
      availableLeaves = remaining.casual;
    }

    if (days > availableLeaves) {
      return {
        success: false,
        error: `Insufficient ${leaveType} leaves. Available: ${availableLeaves} days, Requested: ${days} day${days !== 1 ? 's' : ''}`
      };
    }

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      return {
        success: false,
        error: 'Tenant context missing. Please sign in again.',
      };
    }

    // Get employee data for routing (from Supabase - source of truth)
    const employee = await getEmployeeById(employeeId, tenantCid);
    
    if (!employee) {
      console.error(`⚠️ Employee not found for ID: ${employeeId}`);
      return {
        success: false,
        error: 'Employee not found. Please ensure you are logged in correctly.'
      };
    }
    
    console.log(`[Leave Routing] Employee: ${employee.username} (${employeeId}), Department: ${employee.department || 'N/A'}`);
    
    // Determine category - use provided category or default based on employee department
    let finalCategory = category;
    if (!finalCategory && employee && employee.department) {
      // Map department to category (reverse mapping)
      // Engineering department defaults to Engineering category
      // Technical department defaults to Technical category
      const departmentToCategory = {
        'Engineering': LEAVE_CATEGORIES.ENGINEERING,
        'Technical': LEAVE_CATEGORIES.TECHNICAL,
        'HR': LEAVE_CATEGORIES.HR,
        'Finance': LEAVE_CATEGORIES.FINANCE,
        'Sales': LEAVE_CATEGORIES.SALES,
        'Facilities': LEAVE_CATEGORIES.FACILITIES
      };
      finalCategory = departmentToCategory[employee.department] || LEAVE_CATEGORIES.OTHER;
      console.log(`[Leave Routing] Auto-detected category from department: ${employee.department} → ${finalCategory}`);
    }
    if (!finalCategory) {
      finalCategory = LEAVE_CATEGORIES.OTHER;
      console.log(`[Leave Routing] No category provided and no department found, defaulting to: ${finalCategory}`);
    }

    // Validate category
    const validCategories = Object.values(LEAVE_CATEGORIES);
    if (!validCategories.includes(finalCategory)) {
      return {
        success: false,
        error: 'Invalid category. Must be: engineering, technical, hr, finance, sales, facilities, or other'
      };
    }

    // Route to appropriate manager based on category
    let assignedManager = null;
    const department = CATEGORY_TO_DEPARTMENT_MAP[finalCategory];
    
    console.log(`[Leave Routing] Category: ${finalCategory}, Target Department: ${department || 'N/A'}`);
    
    if (department) {
      try {
        const departmentManagers = await getManagersByDepartment(department, tenantCid);
        console.log(`[Leave Routing] Found ${departmentManagers.length} manager(s) for department: ${department}`);
        
        if (departmentManagers.length > 0) {
          // Direct routing: Each category maps to its own department
          // - "engineering" category → Engineering department → Engineering Manager
          // - "technical" category → Technical department → Technical Manager
          assignedManager = departmentManagers[0];
          console.log(`✓ Leave request (${finalCategory}) will be assigned to ${assignedManager.username} (${assignedManager.position || department} Manager)`);
        } else {
          console.warn(`⚠️ No manager found for department: ${department}. Leave request will not be auto-assigned.`);
          // Fallback: Try to assign to a super_admin if no manager found
          try {
            const superAdmins = await getSuperAdminUsers(tenantCid);
            if (superAdmins.length > 0) {
              assignedManager = superAdmins[0];
              console.log(`✓ Fallback: Assigning leave request to super_admin: ${assignedManager.username}`);
            }
          } catch (fallbackError) {
            console.error('Error getting super_admin for fallback assignment:', fallbackError);
          }
        }
      } catch (error) {
        console.error('Error finding department manager:', error);
        // Fallback: Try to assign to a super_admin on error
        try {
          const superAdmins = await getSuperAdminUsers(tenantCid);
          if (superAdmins.length > 0) {
            assignedManager = superAdmins[0];
            console.log(`✓ Fallback (on error): Assigning leave request to super_admin: ${assignedManager.username}`);
          }
        } catch (fallbackError) {
          console.error('Error getting super_admin for fallback assignment:', fallbackError);
        }
      }
    } else {
      console.log(`[Leave Routing] No department mapping for category: ${finalCategory}, assigning to super_admin`);
      // For 'other' category, assign to super_admin
      try {
        const superAdmins = await getSuperAdminUsers(tenantCid);
        if (superAdmins.length > 0) {
          assignedManager = superAdmins[0];
          console.log(`✓ Assigning leave request to super_admin: ${assignedManager.username}`);
        }
      } catch (fallbackError) {
        console.error('Error getting super_admin for assignment:', fallbackError);
      }
    }

    // Get employee UID for database reference
    // MUST use auth.uid() from current Supabase session for RLS policy to work
    // RLS policy requires: employee_uid = auth.uid()
    let employeeUid = null;
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) {
        console.error('Error getting Supabase session:', authError);
        return {
          success: false,
          error: 'Unable to verify user session. Please log in again.'
        };
      }
      
      if (authUser && authUser.id) {
        employeeUid = authUser.id;
        console.log('✓ Using UID from current Supabase session (auth.uid()):', employeeUid);
      } else {
        // No active session
        console.error('No active Supabase session found');
        return {
          success: false,
          error: 'Please ensure you are logged in. Session not found.'
        };
      }
    } catch (error) {
      console.error('Error getting Supabase session:', error);
      return {
        success: false,
        error: 'Unable to verify user session. Please log in again.'
      };
    }

    // If still no UID, we cannot proceed (RLS requires it)
    if (!employeeUid) {
      console.error('Cannot create leave request: employee_uid is required for RLS policy');
      return {
        success: false,
        error: 'Unable to verify user identity. Please ensure you are logged in correctly.'
      };
    }

    // Create leave request in Supabase
    const requestData = {
      employee_id: employeeId,
      employee_uid: employeeUid,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      days: days,
      reason: reason || null,
      category: finalCategory,
      is_half_day: isHalfDay || false,
      half_day_period: isHalfDay ? (halfDayPeriod || 'morning') : null,
      status: 'pending',
      assigned_to: assignedManager?.username || null,
      processed_at: null,
      processed_by: null,
      admin_notes: null
    };

    const { data: insertedRequest, error: insertError } = await supabase
      .from('leave_requests')
      .insert(requestData)
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting leave request to Supabase:', insertError);
      return {
        success: false,
        error: insertError.message || 'Failed to create leave request in database'
      };
    }

    const requestId = insertedRequest.id;

    // Send notification to super admins and assigned manager
    try {
      const leaveTypeLabels = {
        annual: 'Annual Leave',
        sick: 'Sick Leave',
        casual: 'Casual Leave'
      };
      
      const halfDayText = isHalfDay ? ` (Half Day - ${halfDayPeriod || 'morning'})` : '';
      const daysText = isHalfDay ? 'half day' : `${days} day${days !== 1 ? 's' : ''}`;
      const notificationTitle = 'New Leave Request';
      const categoryLabel = getCategoryLabel(finalCategory);
      const notificationBody = `${employee ? employee.name : 'An employee'} has submitted a ${leaveTypeLabels[leaveType]} request for ${daysText}${halfDayText} (${startDate}${startDate !== endDate ? ` to ${endDate}` : ''})${assignedManager ? ` (Assigned to ${assignedManager.name} - ${categoryLabel})` : ` (${categoryLabel})`}`;
      
      // Get super admins (always notified)
      const superAdmins = await getSuperAdminUsers(tenantCid);
      
      // Combine recipients (super admins + assigned manager if exists)
      const recipients = [...superAdmins];
      if (assignedManager) {
        // Add assigned manager if not already a super admin
        const isSuperAdmin = superAdmins.some(admin => admin.username === assignedManager.username);
        if (!isSuperAdmin) {
          recipients.push(assignedManager);
        }
      }
      
      // Remove duplicates based on username
      const uniqueRecipients = recipients.filter((admin, index, self) =>
        index === self.findIndex(a => a.username === admin.username)
      );
      
      // CRITICAL: Use batch notification creation for reliability
      const recipientUsernames = uniqueRecipients
        .map(r => r.username)
        .filter(u => u); // Filter out any null/undefined usernames
      
      if (recipientUsernames.length > 0) {
        const notificationData = {
          requestId,
          employeeId,
          employeeName: employee ? employee.name : 'Unknown',
          leaveType,
          category: finalCategory,
          days,
          startDate,
          endDate,
          assignedTo: assignedManager?.username || null,
          navigation: {
            screen: 'HRDashboard', // Use HR Dashboard for leave management
            params: {
              initialTab: 'leaves', // Open leaves tab
              openLeaveRequests: true
            }
          }
        };
        
        const batchResult = await createBatchNotifications(
          recipientUsernames,
          notificationTitle,
          notificationBody,
          'leave_request',
          notificationData
        );
        
        if (__DEV__) {
          console.log(`[Leave] Notified ${batchResult.created} recipient(s), ${batchResult.failed} failed`);
          if (batchResult.errors && batchResult.errors.length > 0) {
            console.warn('[Leave] Notification errors:', batchResult.errors);
          }
        }
      } else {
        if (__DEV__) {
          console.warn('[Leave] No valid recipients found for notification');
        }
      }
      
    } catch (notifError) {
      console.error('[Leave] CRITICAL: Error sending notification to admins:', notifError);
      // Don't fail the request if notification fails - ticket was created successfully
    }

    console.log(`Leave request created: ${requestId}`);
    return {
      success: true,
      requestId: requestId
    };
  } catch (error) {
    console.error('Error creating leave request:', error);
    return {
      success: false,
      error: error.message || 'Failed to create leave request'
    };
  }
};

/**
 * Get all leave requests for an employee
 * @param {string} employeeId - Employee ID
 * @returns {Promise<Array>} Array of leave requests
 */
export const getEmployeeLeaveRequests = async (employeeId) => {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser?.id) return [];

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    let resolvedUid = employeeId;
    if (typeof employeeId === 'string' && employeeId.startsWith('emp_')) {
      resolvedUid = employeeId.replace('emp_', '');
    }

    const { data: subj } = await supabase.from('users').select('uid, company_id').eq('uid', resolvedUid).maybeSingle();
    if (tenantCid && subj?.company_id && String(subj.company_id) !== String(tenantCid)) {
      if (__DEV__) console.warn('[tenant] getEmployeeLeaveRequests: user not in current tenant');
      return [];
    }

    const { data: requests, error } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_uid', resolvedUid)
      .order('requested_at', { ascending: false });

    if (error) {
      console.error('Error getting employee leave requests from Supabase:', error);
      return [];
    }

    // Convert database format to app format
    return requests.map(req => ({
      id: req.id,
      employeeId: req.employee_id,
      leaveType: req.leave_type,
      startDate: req.start_date,
      endDate: req.end_date,
      days: req.days,
      reason: req.reason,
      category: req.category,
      isHalfDay: req.is_half_day,
      halfDayPeriod: req.half_day_period,
      status: req.status,
      requestedAt: req.requested_at,
      processedAt: req.processed_at,
      processedBy: req.processed_by,
      adminNotes: req.admin_notes,
      assignedTo: req.assigned_to
    }));
  } catch (error) {
    console.error('Error getting employee leave requests:', error);
    return [];
  }
};

/**
 * Get all pending leave requests (for admin/managers)
 * RLS policies automatically filter based on user role:
 * - Employees see only their own requests
 * - Managers see requests assigned to them or from their department
 * - Super admins see all requests
 * @returns {Promise<Array>} Array of pending leave requests
 */
export const getPendingLeaveRequests = async () => {
  try {
    // Get current user info for debugging
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authUser) {
      console.log(`[Leave Requests] Fetching pending requests for user: ${authUser.user_metadata?.username || authUser.email}, UID: ${authUser.id}`);
    }

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      console.warn('[tenant] getPendingLeaveRequests: no company_id on session user');
      return [];
    }
    const tenantUids = await fetchCompanyUserUids(supabase, tenantCid, 'getPendingLeaveRequests');
    if (tenantUids.length === 0) {
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getPendingLeaveRequests', { auth_company_id: tenantCid, tenant_user_count: tenantUids.length });
    }

    // Query from Supabase — explicit tenant filter (defense in depth vs RLS)
    const { data: requests, error } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'pending')
      .in('employee_uid', tenantUids)
      .order('requested_at', { ascending: false });

    if (error) {
      console.error('Error getting pending leave requests from Supabase:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return [];
    }

    console.log(`[Leave Requests] Found ${requests?.length || 0} pending request(s) (tenant-scoped)`);
    if (requests && requests.length > 0) {
      console.log(`[Leave Requests] Sample request:`, {
        id: requests[0].id,
        employee_id: requests[0].employee_id,
        assigned_to: requests[0].assigned_to,
        category: requests[0].category
      });
    }

    // Fetch employee names in a single query to avoid N+1
    const employeeUids = [...new Set((requests || []).map(req => req.employee_uid).filter(Boolean))];
    const employeeMap = new Map();
    
    if (employeeUids.length > 0) {
      const { data: employees, error: empError } = await supabase
        .from('users')
        .select('uid, username, name, email')
        .in('uid', employeeUids)
        .eq('company_id', tenantCid);
      
      if (!empError && employees) {
        employees.forEach(emp => {
          employeeMap.set(emp.uid, emp);
        });
      }
    }

    // Convert database format to app format with employee names
    return (requests || []).map(req => {
      const employee = employeeMap.get(req.employee_uid);
      return {
        id: req.id,
        employeeId: req.employee_id,
        employeeUid: req.employee_uid,
        employeeName: employee?.name || employee?.username || req.employee_id,
        employeeUsername: employee?.username || req.employee_id,
        leaveType: req.leave_type,
        startDate: req.start_date,
        endDate: req.end_date,
        days: req.days,
        reason: req.reason,
        category: req.category,
        isHalfDay: req.is_half_day,
        halfDayPeriod: req.half_day_period,
        status: req.status,
        requestedAt: req.requested_at,
        processedAt: req.processed_at,
        processedBy: req.processed_by,
        adminNotes: req.admin_notes,
        assignedTo: req.assigned_to
      };
    });
  } catch (error) {
    console.error('Error getting pending leave requests:', error);
    return [];
  }
};

/**
 * Get all leave requests (for admin/managers)
 * RLS policies automatically filter based on user role
 * @returns {Promise<Array>} Array of all leave requests
 */
export const getAllLeaveRequests = async (companyId = null) => {
  try {
    // Get current user info for debugging
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      console.log(`[Leave Requests] Fetching all requests for user: ${authUser.user_metadata?.username || authUser.email}`);
    }

    const tenantCid = requireValidCompanyId(companyId, 'getAllLeaveRequests') || (await fetchSessionUserCompanyId(supabase));
    if (!tenantCid) {
      console.warn('[tenant] getAllLeaveRequests: no company_id');
      return [];
    }
    const tenantUids = await fetchCompanyUserUids(supabase, tenantCid, 'getAllLeaveRequests');
    if (tenantUids.length === 0) {
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getAllLeaveRequests', { queried_company_id: tenantCid, tenant_user_count: tenantUids.length });
    }

    // Query from Supabase — explicit tenant filter
    const { data: requests, error } = await supabase
      .from('leave_requests')
      .select('*')
      .in('employee_uid', tenantUids)
      .order('requested_at', { ascending: false });

    if (error) {
      console.error('Error getting all leave requests from Supabase:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return [];
    }

    console.log(`[Leave Requests] Found ${requests?.length || 0} total request(s) (tenant-scoped)`);

    // Fetch employee names in a single query to avoid N+1
    const employeeUids = [...new Set((requests || []).map(req => req.employee_uid).filter(Boolean))];
    const employeeMap = new Map();
    
    if (employeeUids.length > 0) {
      const { data: employees, error: empError } = await supabase
        .from('users')
        .select('uid, username, name, email')
        .in('uid', employeeUids)
        .eq('company_id', tenantCid);
      
      if (!empError && employees) {
        employees.forEach(emp => {
          employeeMap.set(emp.uid, emp);
        });
        console.log(`[Leave Requests] Loaded ${employees.length} employee name(s) for ${employeeUids.length} unique employee(s)`);
      } else if (empError) {
        console.warn('[Leave Requests] Could not fetch employee names:', empError.message);
      }
    }

    // Convert database format to app format with employee names
    return (requests || []).map(req => {
      const employee = employeeMap.get(req.employee_uid);
      return {
        id: req.id,
        employeeId: req.employee_id,
        employeeUid: req.employee_uid,
        employeeName: employee?.name || employee?.username || req.employee_id,
        employeeUsername: employee?.username || req.employee_id,
        leaveType: req.leave_type,
        startDate: req.start_date,
        endDate: req.end_date,
        days: req.days,
        reason: req.reason,
        category: req.category,
        isHalfDay: req.is_half_day,
        halfDayPeriod: req.half_day_period,
        status: req.status,
        requestedAt: req.requested_at,
        processedAt: req.processed_at,
        processedBy: req.processed_by,
        adminNotes: req.admin_notes,
        assignedTo: req.assigned_to
      };
    });
  } catch (error) {
    console.error('Error getting all leave requests:', error);
    return [];
  }
};

/**
 * Process leave request (approve or reject)
 * @param {string} requestId - Leave request ID
 * @param {string} status - 'approved' or 'rejected'
 * @param {string} processedBy - Username of admin who processed
 * @param {string} adminNotes - Admin notes (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const processLeaveRequest = async (requestId, status, processedBy, adminNotes = '') => {
  try {
    if (status !== 'approved' && status !== 'rejected') {
      return {
        success: false,
        error: 'Invalid status. Must be "approved" or "rejected"'
      };
    }

    // Get the request from Supabase first
    const { data: request, error: fetchError } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) {
      return {
        success: false,
        error: 'Leave request not found'
      };
    }

    // Check if already processed
    if (request.status !== 'pending') {
      return {
        success: false,
        error: `Leave request already ${request.status}`
      };
    }

    // If approved, the balance will be automatically recalculated from Supabase
    // No need to manually update AsyncStorage - getEmployeeLeaveBalance now calculates from Supabase
    // This ensures consistency across all devices
    if (status === 'approved') {
      console.log(`✓ Leave request approved. Balance will be recalculated from Supabase for ${request.employee_id}`);
    }

    // Update request in Supabase
    const { error: updateError } = await supabase
      .from('leave_requests')
      .update({
        status: status,
        processed_at: new Date().toISOString(),
        processed_by: processedBy,
        admin_notes: adminNotes || null
      })
      .eq('id', requestId);

    if (updateError) {
      console.error('Error updating leave request in Supabase:', updateError);
      return {
        success: false,
        error: updateError.message || 'Failed to update leave request'
      };
    }

    // Send notification to employee
    try {
      const tenantCid = await fetchSessionUserCompanyId(supabase);
      const employee = await getEmployeeById(request.employee_uid || request.employee_id, tenantCid);
      
      if (employee) {
        const leaveTypeLabels = {
          annual: 'Annual Leave',
          sick: 'Sick Leave',
          casual: 'Casual Leave'
        };
        
        const notificationTitle = status === 'approved' 
          ? 'Leave Request Approved' 
          : 'Leave Request Rejected';
        const notificationBody = status === 'approved'
          ? `Your ${leaveTypeLabels[request.leave_type]} request for ${request.days} day${request.days !== 1 ? 's' : ''} (${request.start_date} to ${request.end_date}) has been approved.`
          : `Your ${leaveTypeLabels[request.leave_type]} request for ${request.days} day${request.days !== 1 ? 's' : ''} (${request.start_date} to ${request.end_date}) has been rejected.${adminNotes ? `\n\nNote: ${adminNotes}` : ''}`;
        
        const result = await createNotification(
          employee.username,
          notificationTitle,
          notificationBody,
          status === 'approved' ? 'leave_approved' : 'leave_rejected',
          {
            requestId,
            employeeId: request.employee_id,
            leaveType: request.leave_type,
            days: request.days,
            startDate: request.start_date,
            endDate: request.end_date,
            status,
            processedBy,
            adminNotes,
            navigation: {
              screen: 'LeaveRequestScreen',
              params: {
                user: employee
              }
            }
          }
        );
        
        if (result.success) {
          if (__DEV__) {
            console.log(`[Leave] ✓ Notification sent to employee: ${employee.username}`);
          }
        } else {
          console.error(`[Leave] Failed to notify employee ${employee.username}:`, result.error);
        }
      } else {
        if (__DEV__) {
          console.warn('[Leave] Cannot send notification - employee not found');
        }
      }
    } catch (notifError) {
      console.error('[Leave] CRITICAL: Error sending notification to employee:', notifError);
      // Don't fail the processing if notification fails - leave was processed successfully
    }

    console.log(`Leave request ${requestId} ${status} by ${processedBy}`);
    return { success: true };
  } catch (error) {
    console.error('Error processing leave request:', error);
    return {
      success: false,
      error: error.message || 'Failed to process leave request'
    };
  }
};

/**
 * Calculate working days between two dates (excluding weekends)
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {number} Number of working days
 */
const calculateWorkingDays = (startDate, endDate) => {
  let count = 0;
  const current = new Date(startDate);
  
  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    // Count only weekdays (Monday = 1, Friday = 5)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
};

/**
 * Get leave request by ID
 * @param {string} requestId - Leave request ID
 * @returns {Promise<Object|null>} Leave request object or null
 */
export const getLeaveRequestById = async (requestId) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) return null;
    const tenantUids = await fetchCompanyUserUids(supabase, tenantCid, 'getLeaveRequestById');
    if (tenantUids.length === 0) return null;

    const { data: request, error } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (error || !request) {
      console.error('Error getting leave request by ID from Supabase:', error);
      return null;
    }

    if (!tenantUids.includes(request.employee_uid)) {
      if (__DEV__) console.warn('[tenant] getLeaveRequestById: request belongs to another tenant');
      return null;
    }

    // Convert database format to app format
    return {
      id: request.id,
      employeeId: request.employee_id,
      leaveType: request.leave_type,
      startDate: request.start_date,
      endDate: request.end_date,
      days: request.days,
      reason: request.reason,
      category: request.category,
      isHalfDay: request.is_half_day,
      halfDayPeriod: request.half_day_period,
      status: request.status,
      requestedAt: request.requested_at,
      processedAt: request.processed_at,
      processedBy: request.processed_by,
      adminNotes: request.admin_notes,
      assignedTo: request.assigned_to
    };
  } catch (error) {
    console.error('Error getting leave request by ID:', error);
    return null;
  }
};

/**
 * Get approved leave dates for an employee
 * @param {string} employeeId - Employee ID
 * @returns {Promise<Array>} Array of date strings (YYYY-MM-DD) that have approved leaves
 */
export const getApprovedLeaveDates = async (employeeId) => {
  try {
    const requests = await getEmployeeLeaveRequests(employeeId);
    const approvedRequests = requests.filter(req => req.status === 'approved');
    
    const leaveDates = new Set();
    
    approvedRequests.forEach(request => {
      const start = new Date(request.startDate);
      const end = new Date(request.endDate);
      
      // Generate all dates in the range (excluding weekends)
      const current = new Date(start);
      while (current <= end) {
        const dayOfWeek = current.getDay();
        // Only include weekdays (Monday = 1, Friday = 5)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const dateString = current.toISOString().split('T')[0];
          leaveDates.add(dateString);
        }
        current.setDate(current.getDate() + 1);
      }
    });
    
    return Array.from(leaveDates);
  } catch (error) {
    console.error('Error getting approved leave dates:', error);
    return [];
  }
};

/**
 * Get all leave dates with employee information (for admin)
 * @returns {Promise<Object>} Object with date strings as keys and arrays of leave info as values
 * Format: { 'YYYY-MM-DD': [{ employeeId, employeeName, leaveType, reason, ... }, ...] }
 */
export const getAllLeaveDatesWithEmployees = async (companyId = null) => {
  try {
    const tenantCid = requireValidCompanyId(companyId, 'getAllLeaveDatesWithEmployees') || (await fetchSessionUserCompanyId(supabase));
    const allRequests = await getAllLeaveRequests(tenantCid);
    const approvedRequests = allRequests.filter(req => req.status === 'approved');
    
    const leaveDatesMap = {};
    
    for (const request of approvedRequests) {
      const start = new Date(request.startDate);
      const end = new Date(request.endDate);
      
      // Generate all dates in the range (excluding weekends)
      const current = new Date(start);
      while (current <= end) {
        const dayOfWeek = current.getDay();
        // Only include weekdays
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const dateString = current.toISOString().split('T')[0];
          
          if (!leaveDatesMap[dateString]) {
            leaveDatesMap[dateString] = [];
          }
          
          // Get employee name
          const employee = await getEmployeeById(request.employeeUid || request.employeeId, tenantCid);
          
          leaveDatesMap[dateString].push({
            employeeId: request.employeeId,
            employeeName: employee ? employee.name : 'Unknown',
            leaveType: request.leaveType,
            reason: request.reason || '',
            days: request.days,
            startDate: request.startDate,
            endDate: request.endDate,
            isHalfDay: request.isHalfDay || false,
            halfDayPeriod: request.halfDayPeriod || null
          });
        }
        current.setDate(current.getDate() + 1);
      }
    }
    
    return leaveDatesMap;
  } catch (error) {
    console.error('Error getting all leave dates with employees:', error);
    return {};
  }
};
