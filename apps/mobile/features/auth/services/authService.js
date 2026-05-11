// Authentication Service - Business logic for authentication
// Migrated to Supabase
import { supabase } from '../../../core/config/supabase';
import { API_GATEWAY_URL } from '../../../core/config/api';
import {
  normalizeEmailForAuth,
  parseLoginIdentifier,
  usernameEqVariants,
} from '../../../core/auth/normalizeLogin';

async function refreshSessionIfCurrentUser(username) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const metaU = session?.user?.user_metadata?.username;
    if (session?.user && metaU === username) {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn('[authService] refreshSession after profile change:', error.message);
      }
    }
  } catch (e) {
    console.warn('[authService] refreshSessionIfCurrentUser:', e?.message || e);
  }
}

async function resyncTenantMetadataIfSessionUsername(username) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const metaU = session?.user?.user_metadata?.username;
    if (!session?.user || metaU !== username) return;
    const { syncTenantMetadataViaGateway } = await import('../../../core/auth/syncTenantMetadata');
    const syncRes = await syncTenantMetadataViaGateway();
    if (!syncRes.success) {
      console.warn('[authService] Tenant resync after direct DB update failed:', syncRes.error);
      await supabase.auth.refreshSession();
    }
  } catch (e) {
    console.warn('[authService] resyncTenantMetadataIfSessionUsername:', e?.message || e);
  }
}

/**
 * Authenticate user with Supabase (via API Gateway preferred)
 * Supports both username and email login
 * @param {string} usernameOrEmail - Username or email to authenticate
 * @param {string} password - Password to authenticate
 * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
 */
export const authenticateUser = async (usernameOrEmail, password) => {
  const { ident, isEmail } = parseLoginIdentifier(usernameOrEmail);

  try {
    // Try API Gateway first (recommended - uses backend service)
    try {
      const response = await fetch(`${API_GATEWAY_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usernameOrEmail: ident,
          password,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('✓ Authentication successful via API Gateway for:', data.user?.username || ident);
        return {
          success: true,
          user: {
            username: data.user?.username || ident.split('@')[0],
            role: data.user?.role || 'employee',
            uid: data.user?.uid || '',
            email: data.user?.email || ident,
            name: data.user?.name,
            department: data.user?.department || '',
            position: data.user?.position || '',
            workMode: data.user?.workMode || 'in_office',
            companyId: data.user?.company_id != null ? String(data.user.company_id) : null,
            departmentId: data.user?.department_id != null ? String(data.user.department_id) : null,
          }
        };
      }
    } catch (apiError) {
      console.log('API Gateway authentication failed, using Supabase directly:', apiError.message);
    }
    
    // Fallback: Direct Supabase authentication
    let emailForAuth;
    if (isEmail) {
      emailForAuth = normalizeEmailForAuth(ident);
    } else {
      let userData = null;
      for (const u of usernameEqVariants(ident)) {
        const { data: row, error: queryError } = await supabase
          .from('users')
          .select('email, username')
          .eq('username', u)
          .maybeSingle();
        if (queryError) {
          console.warn('[authService] username lookup', u, queryError.message);
        }
        if (row?.email) {
          userData = row;
          break;
        }
      }

      if (!userData?.email) {
        console.log('✗ Authentication failed: User not found');
        return { success: false, error: 'Invalid username or password' };
      }

      emailForAuth = normalizeEmailForAuth(userData.email);
    }

    if (__DEV__) {
      console.log('[authService] direct signIn', {
        isEmail,
        emailHint: `${emailForAuth.slice(0, 2)}***@${emailForAuth.split('@')[1]}`,
      });
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: emailForAuth,
      password,
    });
    
    if (authError || !authData.user) {
      console.error('Supabase authentication error:', authError?.message, { code: authError?.status });
      let errorMessage = 'Invalid username or password';
      
      if (authError?.message?.includes('Invalid login credentials')) {
        errorMessage = 'Invalid username or password';
      } else if (authError?.message?.includes('Email not confirmed')) {
        errorMessage = 'Please verify your email address';
      } else if (authError?.message?.includes('Email rate limit exceeded')) {
        errorMessage = 'Too many failed attempts. Please try again later';
      }
      
      return { success: false, error: errorMessage };
    }
    
    // Get user data from Supabase database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('uid', authData.user.id)
      .single();
    
    if (userError || !userData) {
      console.log('✗ Authentication failed: User data not found');
      return { success: false, error: 'User data not found' };
    }
    
    console.log('✓ Authentication successful for:', userData.username || emailForAuth, 'with role:', userData.role);
    return {
      success: true,
      user: {
        username: userData.username || emailForAuth.split('@')[0],
        role: userData.role || 'employee',
        uid: authData.user.id,
        email: authData.user.email || emailForAuth,
        name: userData.name,
        department: userData.department || '',
        position: userData.position || '',
        workMode: userData.work_mode || 'in_office',
        companyId: userData.company_id != null ? String(userData.company_id) : null,
        departmentId: userData.department_id != null ? String(userData.department_id) : null,
      }
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false, error: error.message || 'Authentication failed' };
  }
};

/**
 * Check if username exists in Supabase
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export const checkUsernameExists = async (username) => {
  try {
    // Try API Gateway first
    try {
      const response = await fetch(`${API_GATEWAY_URL}/api/auth/check-username/${username}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.exists || false;
      }
    } catch (apiError) {
      console.log('API Gateway check failed, using Supabase directly');
    }
    
    // Fallback to Supabase
    const { data, error } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .limit(1);
    
    if (error) {
      console.error('Error checking username:', error);
      return false;
    }
    
    return data && data.length > 0;
  } catch (error) {
    console.error('Error checking username:', error);
    return false;
  }
};

/**
 * Create user in Supabase (via API Gateway)
 * @param {Object} userData - {username, password, email, name, role, department, position, workMode, hireDate}
 * @returns {Promise<{success: boolean, error?: string, uid?: string}>}
 */
export const createUser = async (userData) => {
  try {
    const { 
      username, 
      password, 
      email, 
      name, 
      role,
      department = '',
      position = '',
      workMode = 'in_office',
      hireDate = new Date().toISOString().split('T')[0],
      companyId: companyIdInput,
      company_id: company_id_snake,
    } = userData;

    const companyId = companyIdInput ?? company_id_snake;
    if (!companyId) {
      return {
        success: false,
        error: 'company_id is required for this tenant (no default company fallback)',
      };
    }
    
    if (!username || !password || !role) {
      return { success: false, error: 'Username, password, and role are required' };
    }
    
    if (!email) {
      return { success: false, error: 'Email is required' };
    }
    
    // Check if username already exists
    const usernameExists = await checkUsernameExists(username);
    if (usernameExists) {
      return { success: false, error: 'Username already exists' };
    }
    
    // Create user via API Gateway (recommended)
    try {
      const response = await fetch(`${API_GATEWAY_URL}/api/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
          email,
          name,
          role,
          department,
          position,
          workMode,
          hireDate,
          company_id: companyId,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('✓ User created via API Gateway:', username, `(${role}, ${department || 'No dept'})`);
        return { success: true, uid: data.user?.uid };
      } else {
        return { success: false, error: data.error || 'Failed to create user' };
      }
    } catch (apiError) {
      console.log('API Gateway create failed, using Supabase directly');
      
      // Fallback: Create user directly in Supabase
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            username: username,
            name: name || username,
            company_id: String(companyId),
            role,
            department_id: null,
          },
        },
      });
      
      if (authError || !authData.user) {
        let errorMessage = 'Failed to create user';
        if (authError?.message?.includes('already registered')) {
          errorMessage = 'Email already exists';
        } else if (authError?.message?.includes('Invalid email')) {
          errorMessage = 'Invalid email address';
        }
        return { success: false, error: errorMessage };
      }
      
      // Create user document in Supabase database
      const { error: dbError } = await supabase
        .from('users')
        .insert({
          uid: authData.user.id,
          username: username,
          email: email,
          name: name || username,
          role: role,
          company_id: companyId,
          department: department || '',
          position: position || '',
          work_mode: workMode || 'in_office',
          hire_date: hireDate || new Date().toISOString().split('T')[0],
          is_active: true,
        });
      
      if (dbError) {
        // Try to delete the auth user if database insert fails
        await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
        return { success: false, error: 'Failed to create user profile' };
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id === authData.user.id) {
          const { syncTenantMetadataViaGateway } = await import('../../../core/auth/syncTenantMetadata');
          const syncRes = await syncTenantMetadataViaGateway();
          if (!syncRes.success) {
            console.warn('[authService] Post-signup tenant metadata sync:', syncRes.error);
          }
        }
      } catch (syncErr) {
        console.warn('[authService] Post-signup sync skipped:', syncErr?.message || syncErr);
      }
      
      console.log('✓ User created in Supabase:', username, `(${role}, ${department || 'No dept'})`);
      return { success: true, uid: authData.user.id };
    }
  } catch (error) {
    console.error('Error creating user:', error);
    return { success: false, error: error.message || 'Failed to create user' };
  }
};

/**
 * Update user role in Supabase (via API Gateway)
 * @param {string} username - Username to update
 * @param {string} newRole - New role
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateUserRole = async (username, newRole) => {
  try {
    // Use API Gateway (recommended)
    try {
      const response = await fetch(`${API_GATEWAY_URL}/api/auth/users/${username}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('✓ User role updated via API Gateway:', username, '->', newRole);
        await refreshSessionIfCurrentUser(username);
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Failed to update user role' };
      }
    } catch (apiError) {
      console.log('API Gateway update failed, using Supabase directly');
      
      // Fallback: Update directly in Supabase
      const { error } = await supabase
        .from('users')
        .update({ 
          role: newRole,
          updated_at: new Date().toISOString(),
        })
        .eq('username', username);
      
      if (error) {
        return { success: false, error: error.message || 'Failed to update user role' };
      }
      
      console.log('✓ User role updated in Supabase:', username, '->', newRole);
      await resyncTenantMetadataIfSessionUsername(username);
      return { success: true };
    }
  } catch (error) {
    console.error('Error updating user role:', error);
    return { success: false, error: error.message || 'Failed to update user role' };
  }
};

/**
 * Update user information in Supabase (via API Gateway)
 * @param {string} username - Username to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateUserInfo = async (username, updates) => {
  try {
    // Convert camelCase to snake_case for database
    const dbUpdates = {};
    if (updates.workMode !== undefined) {
      dbUpdates.work_mode = updates.workMode;
    }
    if (updates.hireDate !== undefined) {
      dbUpdates.hire_date = updates.hireDate;
    }
    if (updates.isActive !== undefined) {
      dbUpdates.is_active = updates.isActive;
    }
    
    // Copy other fields
    Object.keys(updates).forEach(key => {
      if (!['workMode', 'hireDate', 'isActive'].includes(key)) {
        dbUpdates[key] = updates[key];
      }
    });
    
    // Use API Gateway (recommended)
    try {
      const response = await fetch(`${API_GATEWAY_URL}/api/auth/users/${username}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates), // API Gateway handles conversion
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('✓ User info updated via API Gateway:', username);
        await refreshSessionIfCurrentUser(username);
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Failed to update user info' };
      }
    } catch (apiError) {
      console.log('API Gateway update failed, using Supabase directly');
      
      // Fallback: Update directly in Supabase
      dbUpdates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('users')
        .update(dbUpdates)
        .eq('username', username);
      
      if (error) {
        return { success: false, error: error.message || 'Failed to update user info' };
      }
      
      console.log('✓ User info updated in Supabase:', username);
      await resyncTenantMetadataIfSessionUsername(username);
      return { success: true };
    }
  } catch (error) {
    console.error('Error updating user info:', error);
    return { success: false, error: error.message || 'Failed to update user info' };
  }
};
