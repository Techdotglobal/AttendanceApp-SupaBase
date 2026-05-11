// Employee management utilities
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';
import { WORK_MODES } from './workModes';

const EMPLOYEES_KEY = 'company_employees';
const WORK_MODE_REQUESTS_KEY = 'work_mode_requests';
const WORK_MODE_HISTORY_KEY = 'work_mode_history';

/**
 * Initialize default employees - merges with existing employees
 * Adds any missing default employees to the existing list
 */
export const initializeDefaultEmployees = async () => {
  try {
    const existingEmployees = await getEmployees();
    
      const defaultEmployees = [
        {
          id: 'emp_001',
          username: 'testuser',
          name: 'Test User',
          email: 'testuser@company.com',
          role: 'employee',
          workMode: WORK_MODES.IN_OFFICE,
          department: 'Engineering',
          position: 'AI Engineer',
          hireDate: '2023-01-15',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_002',
          username: 'testadmin',
          name: 'Test Admin',
          email: 'admin@company.com',
          role: 'super_admin',
          workMode: WORK_MODES.IN_OFFICE,
          department: 'Management',
          position: 'System Administrator',
          hireDate: '2023-01-01',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_003',
          username: 'john.doe',
          name: 'John Doe',
          email: 'john.doe@company.com',
          role: 'employee',
          workMode: WORK_MODES.SEMI_REMOTE,
          department: 'Engineering',
          position: 'Senior AI Engineer',
          hireDate: '2022-06-10',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_004',
          username: 'jane.smith',
          name: 'Jane Smith',
          email: 'jane.smith@company.com',
          role: 'employee',
          workMode: WORK_MODES.FULLY_REMOTE,
          department: 'Design',
          position: 'UI/UX Designer',
          hireDate: '2022-08-20',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_005',
          username: 'mike.johnson',
          name: 'Mike Johnson',
          email: 'mike.johnson@company.com',
          role: 'employee',
          workMode: WORK_MODES.IN_OFFICE,
          department: 'Sales',
          position: 'Sales Manager',
          hireDate: '2022-03-15',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_006',
          username: 'sarah.williams',
          name: 'Sarah Williams',
          email: 'sarah.williams@company.com',
          role: 'employee',
          workMode: WORK_MODES.SEMI_REMOTE,
          department: 'Marketing',
          position: 'Marketing Specialist',
          hireDate: '2023-02-01',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_007',
          username: 'david.brown',
          name: 'David Brown',
          email: 'david.brown@company.com',
          role: 'employee',
          workMode: WORK_MODES.FULLY_REMOTE,
          department: 'Engineering',
          position: 'DevOps Engineer',
          hireDate: '2022-11-05',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_010',
          username: 'hrmanager',
          name: 'HR Manager',
          email: 'hrmanager@company.com',
          role: 'manager',
          workMode: WORK_MODES.IN_OFFICE,
          department: 'HR',
          position: 'HR Manager',
          hireDate: '2022-03-01',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_011',
          username: 'techmanager',
          name: 'Tech Manager',
          email: 'techmanager@company.com',
          role: 'manager',
          workMode: WORK_MODES.IN_OFFICE,
          department: 'Engineering',
          position: 'Engineering Manager',
          hireDate: '2022-02-15',
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'emp_012',
          username: 'salesmanager',
          name: 'Sales Manager',
          email: 'salesmanager@company.com',
          role: 'manager',
          workMode: WORK_MODES.IN_OFFICE,
          department: 'Sales',
          position: 'Sales Manager',
          hireDate: '2022-01-20',
          isActive: true,
          createdAt: new Date().toISOString()
        }
      ];
      
      // If no existing employees, just save the defaults
      if (existingEmployees.length === 0) {
      await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(defaultEmployees));
      console.log('Default employees initialized');
      } else {
        // Merge: Add any missing default employees and update roles for existing ones
        const existingUsernames = new Set(existingEmployees.map(emp => emp.username));
        const existingIds = new Set(existingEmployees.map(emp => emp.id));
        
        // Filter out employees that already exist (by username) and ensure no duplicate IDs
        const missingEmployees = defaultEmployees.filter(emp => 
          !existingUsernames.has(emp.username) && !existingIds.has(emp.id)
        );
        
        // Update existing employees with correct roles from defaults
        const updatedEmployees = existingEmployees.map(existingEmp => {
          const defaultEmp = defaultEmployees.find(def => def.username === existingEmp.username);
          if (defaultEmp) {
            // Update role and other fields if they don't match the default
            if (existingEmp.role !== defaultEmp.role) {
              console.log(`Updating role for ${existingEmp.username} from ${existingEmp.role} to ${defaultEmp.role}`);
            }
            // Merge default data with existing, keeping existing ID if different
            return { 
              ...defaultEmp, 
              id: existingEmp.id, // Keep existing ID to avoid duplicates
              createdAt: existingEmp.createdAt || defaultEmp.createdAt // Keep original creation date
            };
          }
          return existingEmp;
        });
        
        // Remove any duplicates by ID before combining
        const uniqueExisting = updatedEmployees.filter((emp, index, self) => 
          index === self.findIndex(e => e.id === emp.id)
        );
        
        // Combine updated existing employees with missing ones
        const mergedEmployees = [...uniqueExisting, ...missingEmployees];
        
        // Final check: remove any remaining duplicates by ID
        const finalEmployees = mergedEmployees.filter((emp, index, self) => 
          index === self.findIndex(e => e.id === emp.id)
        );
        
        await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(finalEmployees));
        
        if (missingEmployees.length > 0) {
          console.log(`Added ${missingEmployees.length} new default employees`);
        } else {
          console.log('All default employees already exist');
        }
    }
  } catch (error) {
    console.error('Error initializing default employees:', error);
  }
};

/**
 * Get all employees
 * @returns {Promise<Array>} Array of employee objects
 */
export const getEmployees = async () => {
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

    // Build query - always filter by is_active = true
    let query = supabase
      .from('users')
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
      .eq('is_active', true);

    // Apply role-based filtering
    // Super admins can see all employees
    if (user.role === 'super_admin') {
      // No additional filtering - show all active employees
    }
    // Managers can only see employees from their department
    else if (user.role === 'manager') {
      query = query.eq('department', user.department);
    }
    // Regular employees can see all employees (for calendar visibility)
    // This allows employees to see who else is in the company for event creation
    else {
      // No additional filtering - show all active employees
    }

    const { data: employees, error } = await query.order('name', { ascending: true });

    if (error) {
      console.error('Error fetching employees from Supabase for Calendar:', error);
      return [];
    }

    if (!employees || employees.length === 0) {
      console.log('No active employees found in Supabase for Calendar');
      return [];
    }

    // Convert Supabase format to app format
    const formattedEmployees = employees.map(emp => ({
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
      isActive: emp.is_active
    }));

    console.log(`✓ Fetched ${formattedEmployees.length} active employee(s) from Supabase for Calendar (User: ${user.username}, Role: ${user.role}${user.department ? `, Department: ${user.department}` : ''})`);
    return formattedEmployees;
  } catch (error) {
    console.error('Error getting employees for Calendar:', error);
    return [];
  }
};

/**
 * Get employee by username
 * @param {string} username - Username to search for
 * @returns {Promise<Object|null>} Employee object or null
 */
export const getEmployeeByUsername = async (username) => {
  try {
    // First, try to get from Supabase (source of truth)
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
        .eq('username', username)
        .eq('is_active', true)
        .maybeSingle();
      
      if (!error && user) {
        // Convert Supabase format to app format
        const formattedEmployee = {
          id: `emp_${user.uid}`,
          uid: user.uid,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          position: user.position,
          workMode: user.work_mode,
          hireDate: user.hire_date,
          isActive: user.is_active
        };
        
        console.log(`✓ Found employee ${username} from Supabase (Department: ${user.department})`);
        return formattedEmployee;
      }
    } catch (supabaseError) {
      console.log('Could not get employee from Supabase, falling back to AsyncStorage:', supabaseError.message);
    }
    
    // Fallback to AsyncStorage
    const employees = await getEmployees();
    const employee = employees.find(emp => emp.username === username) || null;
    if (employee) {
      console.log(`✓ Found employee ${username} from AsyncStorage (Department: ${employee.department || 'N/A'})`);
    }
    return employee;
  } catch (error) {
    console.error('Error getting employee by username:', error);
    return null;
  }
};

/**
 * Get employee by ID
 * @param {string} employeeId - Employee ID to search for (can be 'emp_xxx' or just 'xxx' or UID)
 * @returns {Promise<Object|null>} Employee object or null
 */
export const getEmployeeById = async (employeeId) => {
  try {
    // Extract UID from employeeId (handle formats like 'emp_xxx' or just 'xxx' or full UID)
    let uid = employeeId;
    if (employeeId.startsWith('emp_')) {
      uid = employeeId.replace('emp_', '');
    }
    
    // First, try to get from Supabase (source of truth)
    try {
      // Try querying by UID (without 'emp_' prefix)
      let { data: user, error } = await supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
        .eq('uid', uid)
        .eq('is_active', true)
        .maybeSingle();
      
      // If not found, try the original employeeId (in case it's already a UID)
      if (error || !user) {
        const { data: user2, error: error2 } = await supabase
          .from('users')
          .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
          .eq('uid', employeeId)
          .eq('is_active', true)
          .maybeSingle();
        
        if (!error2 && user2) {
          user = user2;
          error = null;
        }
      }
      
      if (!error && user) {
        // Convert Supabase format to app format
        const formattedEmployee = {
          id: `emp_${user.uid}`,
          uid: user.uid,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          position: user.position,
          workMode: user.work_mode,
          hireDate: user.hire_date,
          isActive: user.is_active
        };
        
        console.log(`✓ Found employee by ID ${employeeId} from Supabase (Username: ${user.username}, Department: ${user.department})`);
        return formattedEmployee;
      }
    } catch (supabaseError) {
      console.log('Could not get employee from Supabase, falling back to AsyncStorage:', supabaseError.message);
    }
    
    // Fallback to AsyncStorage
    const employees = await getEmployees();
    const employee = employees.find(emp => emp.id === employeeId || emp.uid === uid) || null;
    if (employee) {
      console.log(`✓ Found employee by ID ${employeeId} from AsyncStorage (Username: ${employee.username}, Department: ${employee.department || 'N/A'})`);
    }
    return employee;
  } catch (error) {
    console.error('Error getting employee by ID:', error);
    return null;
  }
};

/**
 * Get all admin users (super_admins and managers only)
 * @returns {Promise<Array>} Array of admin employee objects
 */
export const getAdminUsers = async () => {
  try {
    // First, try to get from Supabase (source of truth)
    try {
      const { data: admins, error } = await supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
        .in('role', ['manager', 'super_admin'])
        .eq('is_active', true)
        .order('role', { ascending: false }) // super_admin first, then manager
        .order('name', { ascending: true });
      
      if (!error && admins && admins.length > 0) {
        // Convert Supabase format to app format
        const formattedAdmins = admins.map(admin => ({
          id: `emp_${admin.uid}`,
          uid: admin.uid,
          username: admin.username,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          department: admin.department,
          position: admin.position,
          workMode: admin.work_mode,
          hireDate: admin.hire_date,
          isActive: admin.is_active
        }));
        
        console.log(`✓ Found ${formattedAdmins.length} admin user(s) from Supabase (${formattedAdmins.filter(a => a.role === 'super_admin').length} super_admin, ${formattedAdmins.filter(a => a.role === 'manager').length} manager)`);
        return formattedAdmins;
      }
    } catch (supabaseError) {
      console.log('Could not get admin users from Supabase, falling back to AsyncStorage:', supabaseError.message);
    }
    
    // Fallback to AsyncStorage
    const employees = await getEmployees();
    return employees.filter(emp => 
      (emp.role === 'super_admin' || emp.role === 'manager') && emp.isActive
    );
  } catch (error) {
    console.error('Error getting admin users:', error);
    return [];
  }
};

/**
 * Get super admin users only
 * @returns {Promise<Array>} Array of super admin employee objects
 */
export const getSuperAdminUsers = async () => {
  try {
    // First, try to get from Supabase (source of truth)
    try {
      const { data: superAdmins, error } = await supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
        .eq('role', 'super_admin')
        .eq('is_active', true);
      
      if (!error && superAdmins && superAdmins.length > 0) {
        // Convert Supabase format to app format
        const formattedAdmins = superAdmins.map(admin => ({
          id: `emp_${admin.uid}`,
          uid: admin.uid,
          username: admin.username,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          department: admin.department,
          position: admin.position,
          workMode: admin.work_mode,
          hireDate: admin.hire_date,
          isActive: admin.is_active
        }));
        
        console.log(`✓ Found ${formattedAdmins.length} super_admin(s) from Supabase`);
        return formattedAdmins;
      }
    } catch (supabaseError) {
      console.log('Could not get super_admins from Supabase, falling back to AsyncStorage:', supabaseError.message);
    }
    
    // Fallback to AsyncStorage
    const employees = await getEmployees();
    return employees.filter(emp => emp.role === 'super_admin' && emp.isActive);
  } catch (error) {
    console.error('Error getting super admin users:', error);
    return [];
  }
};

/**
 * Get managers for a specific department
 * @param {string} department - Department name
 * @returns {Promise<Array>} Array of manager employee objects for the department
 */
export const getManagersByDepartment = async (department) => {
  try {
    // First, try to get from Supabase (source of truth)
    try {
      const { data: managers, error } = await supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
        .eq('role', 'manager')
        .eq('department', department)
        .eq('is_active', true);
      
      if (!error && managers && managers.length > 0) {
        // Convert Supabase format to app format
        const formattedManagers = managers.map(manager => ({
          id: `emp_${manager.uid}`,
          uid: manager.uid,
          username: manager.username,
          name: manager.name,
          email: manager.email,
          role: manager.role,
          department: manager.department,
          position: manager.position,
          workMode: manager.work_mode,
          hireDate: manager.hire_date,
          isActive: manager.is_active
        }));
        
        console.log(`✓ Found ${formattedManagers.length} manager(s) in ${department} from Supabase`);
        return formattedManagers;
      }
    } catch (supabaseError) {
      console.log('Could not get managers from Supabase, falling back to AsyncStorage:', supabaseError.message);
    }
    
    // Fallback to AsyncStorage
    const employees = await getEmployees();
    const managers = employees.filter(emp => 
      emp.role === 'manager' && 
      emp.department === department && 
      emp.isActive
    );
    
    if (managers.length > 0) {
      console.log(`✓ Found ${managers.length} manager(s) in ${department} from AsyncStorage`);
    } else {
      console.warn(`⚠️ No managers found for department: ${department}`);
    }
    
    return managers;
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
    // First, try to get from Supabase (source of truth)
    try {
      let query = supabase
        .from('users')
        .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
        .eq('is_active', true);
      
      // Super admins can manage EVERYONE (including other super admins)
      // No filtering needed - they see all active users
      if (user.role === 'super_admin') {
        // No role filter - super_admin sees ALL active users
      } 
      // HR admins can manage all employees (except super admins)
      else if (user.role === 'manager' && user.department === 'HR') {
        query = query.neq('role', 'super_admin');
      }
      // Managers can only manage employees in their department
      else if (user.role === 'manager') {
        query = query
          .eq('department', user.department)
          .neq('role', 'super_admin')
          .neq('role', 'manager'); // Managers can't manage other managers
      } 
      // Employees and regular admins can't manage anyone
      else {
        return [];
      }
      
      // Add explicit ordering and ensure no limit (Supabase default is 1000, but we want all)
      query = query.order('name', { ascending: true });
      
      const { data: employees, error } = await query;
      
      if (error) {
        console.error('Error fetching manageable employees from Supabase:', error);
        throw error; // Let it fall through to AsyncStorage fallback
      }
      
      // Always return results, even if empty (to distinguish from error)
      const formattedEmployees = (employees || []).map(emp => ({
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
        isActive: emp.is_active
      }));
      
      console.log(`✓ Found ${formattedEmployees.length} manageable employee(s) from Supabase for ${user.username} (${user.role}, ${user.department || 'N/A'})`);
      
      if (formattedEmployees.length > 0) {
        return formattedEmployees;
      }
      
      // If no employees found, log warning but don't fall back to AsyncStorage
      // (Supabase is source of truth - empty result is valid)
      console.warn(`⚠️ No manageable employees found in Supabase for ${user.username} (${user.role}, ${user.department || 'N/A'})`);
      return [];
    } catch (supabaseError) {
      console.log('Could not get employees from Supabase, falling back to AsyncStorage:', supabaseError.message);
    }
    
    // Fallback to AsyncStorage
    const employees = await getEmployees();
    
    // Super admins can manage EVERYONE (including other super admins)
    if (user.role === 'super_admin') {
      return employees.filter(emp => emp.isActive);
    }
    
    // HR admins can manage all employees (except super admins)
    if (user.role === 'manager' && user.department === 'HR') {
      return employees.filter(emp => emp.isActive && emp.role !== 'super_admin');
    }
    
    // Managers can only manage employees in their department
    if (user.role === 'manager') {
      return employees.filter(emp => 
        emp.isActive && 
        emp.department === user.department &&
        emp.role !== 'super_admin' &&
        emp.role !== 'manager' // Managers can't manage other managers
      );
    }
    
    // Employees and regular admins can't manage anyone
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
  
  // Super admins can manage everyone
  if (user.role === 'super_admin') {
    return true;
  }
  
  // HR managers can manage all employees (special case)
  if (user.role === 'manager' && user.department === 'HR') {
    return employee.role !== 'super_admin';
  }
  
  // Other managers can only manage employees (non-manager, non-super_admin) in their department
  if (user.role === 'manager') {
    return employee.department === user.department 
      && employee.role !== 'super_admin' 
      && employee.role !== 'manager'; // Managers can't manage other managers
  }
  
  // Only super admins and managers can manage employees
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
    if (employeeId.startsWith('emp_')) {
      const uid = employeeId.replace('emp_', '');
      targetEmployee = await getEmployeeById(uid);
      targetUid = uid;
    } else {
      // Try as UID first
      targetEmployee = await getEmployeeById(employeeId);
      if (targetEmployee) {
        targetUid = targetEmployee.uid || employeeId;
      } else {
        // If not found, try as username
        targetEmployee = await getEmployeeByUsername(employeeId);
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

    // Get old work mode for history
    const oldWorkMode = targetEmployee.workMode || targetEmployee.work_mode;

    // Update directly in Supabase using UID (most reliable identifier)
    // This ensures RLS policies are properly enforced
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ 
        work_mode: newWorkMode,
        updated_at: new Date().toISOString()
      })
      .eq('uid', targetUid)
      .select('uid, username, email, name, role, department, position, work_mode, hire_date, is_active')
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
export const processWorkModeRequest = async (requestId, status, processedBy, adminNotes = '') => {
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
      // Get the user who is processing the request (for permission checks)
      // Note: processedBy is a username, we need to get the full user object
      const processingUser = await getEmployeeByUsername(processedBy);
      if (processingUser) {
        const employee = await getEmployeeByUsername(request.employeeId);
        if (employee) {
          const result = await updateEmployeeWorkMode(
            employee.id || employee.uid, 
            request.requestedMode, 
            processingUser
          );
          if (!result.success) {
            console.error('Failed to update work mode:', result.error);
            // Don't fail the request processing, just log the error
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
 * Get work mode statistics
 * @returns {Promise<Object>} Statistics object
 */
export const getWorkModeStatistics = async () => {
  try {
    const employees = await getEmployees();
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
    } = employeeData;

    // Validate required fields
    if (!username || !password || !name || !email) {
      return { success: false, error: 'Username, password, name, and email are required' };
    }

    // Check if username already exists
    const existingEmployee = await getEmployeeByUsername(username);
    if (existingEmployee) {
      return { success: false, error: 'Username already exists' };
    }

    // Check if username exists in Supabase
    const { checkUsernameExists, addUserToFile } = await import('./auth');
    const usernameExists = await checkUsernameExists(username);
    if (usernameExists) {
      return { success: false, error: 'Username already exists in system' };
    }

    // Create employee ID
    const employeeId = `emp_${Date.now()}`;

    // Create employee object
    const newEmployee = {
      id: employeeId,
      username,
      name,
      email,
      role,
      department,
      position,
      workMode,
      hireDate,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    // Add to employees list
    const employees = await getEmployees();
    employees.push(newEmployee);
    await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));

    // Create user in Supabase
    const addUserResult = await addUserToFile({
      username,
      password,
      email,
      name,
      role,
      department,
      position,
      workMode,
      hireDate,
      companyId: companyId ?? company_id,
    });

    if (!addUserResult.success) {
      // Rollback: remove employee if user creation failed
      const updatedEmployees = employees.filter(emp => emp.id !== employeeId);
      await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(updatedEmployees));
      return { success: false, error: addUserResult.error || 'Failed to create user account' };
    }

    console.log('✓ Employee created:', employeeId);
    return { success: true, id: employeeId };
  } catch (error) {
    console.error('Error creating employee:', error);
    return { success: false, error: error.message || 'Failed to create employee' };
  }
};

/**
 * Update employee information (including role)
 * @param {string} employeeId - Employee ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateEmployee = async (employeeId, updates) => {
  try {
    const employees = await getEmployees();
    const employeeIndex = employees.findIndex(emp => emp.id === employeeId);

    if (employeeIndex === -1) {
      return { success: false, error: 'Employee not found' };
    }

    const employee = employees[employeeIndex];
    const updatedEmployee = {
      ...employee,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // If role is being updated, also update Supabase
    if (updates.role && updates.role !== employee.role) {
      const { updateUserRole } = await import('./auth');
      const updateRoleResult = await updateUserRole(employee.username, updates.role);
      
      if (!updateRoleResult.success) {
        return { success: false, error: updateRoleResult.error || 'Failed to update user role' };
      }
    }

    employees[employeeIndex] = updatedEmployee;
    await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));

    console.log('✓ Employee updated:', employeeId);
    return { success: true };
  } catch (error) {
    console.error('Error updating employee:', error);
    return { success: false, error: error.message || 'Failed to update employee' };
  }
};

/**
 * Delete employee (soft delete - set isActive to false)
 * @param {string} employeeId - Employee ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteEmployee = async (employeeId) => {
  try {
    return await updateEmployee(employeeId, { isActive: false });
  } catch (error) {
    console.error('Error deleting employee:', error);
    return { success: false, error: error.message || 'Failed to delete employee' };
  }
};
