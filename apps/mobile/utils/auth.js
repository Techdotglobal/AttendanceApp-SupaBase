// Supabase Authentication
import { API_GATEWAY_URL, API_TIMEOUT } from '../core/config/api';
import { supabase } from '../core/config/supabase';

async function refreshSessionIfCurrentUser(username) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const metaU = session?.user?.user_metadata?.username;
    if (session?.user && metaU === username) {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn('[AUTH] refreshSession after profile change:', error.message);
      }
    }
  } catch (e) {
    console.warn('[AUTH] refreshSessionIfCurrentUser:', e?.message || e);
  }
}

/** When DB was updated without auth-service, push JWT from DB for the signed-in user only. */
async function resyncTenantMetadataIfSessionUsername(username) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const metaU = session?.user?.user_metadata?.username;
    if (!session?.user || metaU !== username) return;
    const { syncTenantMetadataViaGateway } = await import('../core/auth/syncTenantMetadata');
    const syncRes = await syncTenantMetadataViaGateway();
    if (!syncRes.success) {
      console.warn('[AUTH] Tenant resync after direct DB update failed:', syncRes.error);
      await supabase.auth.refreshSession();
    }
  } catch (e) {
    console.warn('[AUTH] resyncTenantMetadataIfSessionUsername:', e?.message || e);
  }
}

/**
 * Authenticate user - tries API Gateway first, falls back to Supabase
 * Supports both username and email login
 * @param {string} usernameOrEmail - Username or email to authenticate
 * @param {string} password - Password to authenticate
 * @returns {Promise<{success: boolean, user?: {username: string, role: string}}>}
 */
export const authenticateUser = async (usernameOrEmail, password) => {
  // ===== CRITICAL FIX: Clear existing session before new login =====
  // This prevents crashes when switching users (especially manager → employee)
  try {
    const { data: { session: existingSession } } = await supabase.auth.getSession();
    if (existingSession) {
      console.log('[AUTH] Existing session found, signing out:', existingSession.user.email);
      await supabase.auth.signOut();
      // Wait for signOut to complete and clear AsyncStorage
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Defensive: Clear AsyncStorage session keys
      try {
        const { clearSupabaseSession } = await import('./sessionHelper');
        await clearSupabaseSession();
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (clearError) {
        console.warn('[AUTH] Error clearing session storage:', clearError);
      }
    }
  } catch (clearError) {
    console.warn('[AUTH] Error clearing existing session:', clearError);
    // Continue anyway - try to proceed with login
  }
  // ===== END FIX =====
  
  // First, try API Gateway (recommended - uses backend service)
  try {
    // Ensure API_GATEWAY_URL is a string
    const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
    const loginUrl = `${gatewayUrl}/api/auth/login`;
    
    if (__DEV__) {
      console.log('Attempting authentication via API Gateway...');
      console.log('API Gateway URL:', gatewayUrl);
      console.log('Full login URL:', loginUrl);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usernameOrEmail: usernameOrEmail.trim(),
        password: password,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    // If API Gateway returns success, use it
    if (response.ok && data.success) {
      console.log('✓ Authentication successful via API Gateway for:', data.user?.username || usernameOrEmail);
      
      // IMPORTANT: We need to establish a Supabase session for RLS policies to work
      // API Gateway authenticates on the backend, but we need client-side session for database operations
      try {
        // Get email from API Gateway response or resolve from username
        let email = data.user?.email || usernameOrEmail;
        
        // If email is not provided and input is a username, look it up
        if (!email.includes('@') || !data.user?.email) {
          const { data: userData } = await supabase
            .from('users')
            .select('email')
            .eq('username', data.user?.username || usernameOrEmail)
            .single();
          
          if (userData?.email) {
            email = userData.email;
          }
        }
        
        // Establish Supabase session with the same credentials
        // This is needed for RLS policies (auth.uid()) to work
        const { data: authData, error: sessionError } = await supabase.auth.signInWithPassword({
          email: email,
          password: password,
        });
        
        if (sessionError) {
          console.warn('⚠️ Could not establish Supabase session after API Gateway login:', sessionError.message);
          console.warn('⚠️ Database operations requiring RLS may fail. Consider using direct Supabase authentication.');
        } else if (authData?.user) {
          console.log('✓ Supabase session established for RLS policies');
        }
      } catch (sessionError) {
        console.warn('⚠️ Error establishing Supabase session:', sessionError.message);
        // Continue anyway - user is authenticated via API Gateway
      }
      
      return {
        success: true,
        user: {
          username: data.user?.username || usernameOrEmail.split('@')[0],
          role: data.user?.role || 'employee',
          uid: data.user?.uid || '',
          email: data.user?.email || usernameOrEmail,
          name: data.user?.name,
          department: data.user?.department || '',
          position: data.user?.position || '',
          workMode: data.user?.workMode || 'in_office',
          companyId: data.user?.company_id != null ? String(data.user.company_id) : null,
          departmentId: data.user?.department_id != null ? String(data.user.department_id) : null,
        },
      };
    }
    
    // If API Gateway returns an error (but not a service error), fallback to Supabase
    if (response.status !== 503 && response.status !== 504) {
      console.log('API Gateway returned error, falling back to Supabase:', data.error || 'Unknown error');
      // Continue to Supabase fallback below
    } else {
      // Service unavailable, fallback to Supabase
      console.log('API Gateway unavailable, falling back to Supabase');
      // Continue to Supabase fallback below
    }
  } catch (error) {
    // API Gateway call failed (network error, timeout, etc.), fallback to Supabase
    if (error.name === 'AbortError') {
      console.log('API Gateway request timed out, falling back to Supabase');
    } else {
      const errorMessage = error.message || 'Unknown error';
      const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'undefined');
      console.log('API Gateway request failed, falling back to Supabase:', errorMessage);
      
      if (__DEV__) {
        console.log('API Gateway URL attempted:', gatewayUrl);
        console.log('Full URL:', `${gatewayUrl}/api/auth/login`);
        console.log('Error details:', {
          name: error.name,
          message: error.message,
          code: error.code,
        });
        console.log('💡 Tip: Make sure API Gateway is running and URL is correct for your platform');
        console.log('   - iOS Simulator: http://localhost:3000');
        console.log('   - Android Emulator: http://10.0.2.2:3000');
        console.log('   - Physical Device: http://<your-computer-ip>:3000');
        console.log('   - Current URL:', gatewayUrl);
      }
    }
    // Continue to Supabase fallback below
  }
  
  // Fallback to Supabase authentication (direct client-side auth)
  try {
    console.log('Attempting authentication via Supabase...');
    let email = usernameOrEmail.trim();
    
    // Check if input is a username (not an email)
    if (!usernameOrEmail.includes('@')) {
      // Find user by username in Supabase database
      const { data: userData, error: queryError } = await supabase
        .from('users')
        .select('email, username')
        .eq('username', usernameOrEmail)
        .limit(1)
        .single();
      
      if (queryError || !userData) {
        console.log('✗ Authentication failed: User not found');
        return { success: false, error: 'Invalid username or password' };
      }
      
      email = userData.email;
      
      if (!email) {
        console.log('✗ Authentication failed: No email found for username');
        return { success: false, error: 'Invalid username or password' };
      }
    }
    
    // Authenticate with Supabase using email
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });
    
    if (authError || !authData.user) {
      console.error('Supabase authentication error:', authError?.message);
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
    // First try by uid (should match Supabase Auth user ID)
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('uid', authData.user.id)
      .single();
    
    // If uid query fails, try by email as fallback
    if (userError || !userData) {
      console.log('Query by uid failed, trying by email...', userError?.message);
      if (authData.user.email) {
        const { data: userDataByEmail, error: emailError } = await supabase
          .from('users')
          .select('*')
          .eq('email', authData.user.email)
          .single();
        
        if (!emailError && userDataByEmail) {
          console.log('Found user by email:', userDataByEmail.username);
          userData = userDataByEmail;
          userError = null;
        } else {
          console.error('Error loading user data by email:', emailError);
        }
      }
    }
    
    if (userError || !userData) {
      console.log('✗ Authentication failed: User data not found');
      return { success: false, error: 'User data not found' };
    }
    
    console.log('✓ Authentication successful via Supabase for:', userData.username || email, 'with role:', userData.role);
    return {
      success: true,
      user: {
        username: userData.username || email.split('@')[0],
        role: userData.role || 'employee',
        uid: authData.user.id,
        email: authData.user.email || email,
        name: userData.name,
        department: userData.department || '',
        position: userData.position || '',
        workMode: userData.work_mode || 'in_office',
        companyId: userData.company_id != null ? String(userData.company_id) : null,
        departmentId: userData.department_id != null ? String(userData.department_id) : null,
      }
    };
  } catch (error) {
    console.error('Supabase authentication error:', error);
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
      const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
      const response = await fetch(`${gatewayUrl}/api/auth/check-username/${username}`, {
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
export const addUserToFile = async (userData) => {
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

    let companyId = companyIdInput ?? company_id_snake;
    if (!companyId) {
      const { data: comp, error: compErr } = await supabase
        .from('companies')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (compErr) {
        console.warn('[AUTH] Could not load default company:', compErr.message);
      }
      companyId = comp?.id;
    }
    if (!companyId) {
      return { success: false, error: 'companyId is required (no companies row to default to)' };
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
      const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
      const response = await fetch(`${gatewayUrl}/api/auth/users`, {
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
          const { syncTenantMetadataViaGateway } = await import('../core/auth/syncTenantMetadata');
          const syncRes = await syncTenantMetadataViaGateway();
          if (!syncRes.success) {
            console.warn('[AUTH] Post-signup tenant metadata sync:', syncRes.error);
          }
        }
      } catch (syncErr) {
        console.warn('[AUTH] Post-signup sync skipped:', syncErr?.message || syncErr);
      }
      
      console.log('✓ User created in Supabase:', username, `(${role}, ${department || 'No dept'})`);
      return { success: true, uid: authData.user.id };
    }
  } catch (error) {
    console.error('Error adding user:', error);
    return { success: false, error: error.message || 'Failed to add user' };
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
      const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
      const response = await fetch(`${gatewayUrl}/api/auth/users/${username}/role`, {
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
 * @param {Object} updates - Fields to update (department, position, workMode, hireDate, etc.)
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
      const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
      const response = await fetch(`${gatewayUrl}/api/auth/users/${username}`, {
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

/**
 * Delete user account via API Gateway (Auth + users table)
 * @param {string} uid - Target user uid
 * @param {Object} requester - Current user context { uid, role, department }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteUserAccount = async (uid, requester) => {
  try {
    if (!uid) {
      return { success: false, error: 'User uid is required' };
    }
    if (!requester || !requester.uid || !requester.role) {
      return { success: false, error: 'Requester context is required' };
    }

    const gatewayUrl = typeof API_GATEWAY_URL === 'string'
      ? API_GATEWAY_URL
      : String(API_GATEWAY_URL || 'http://localhost:3000');

    const response = await fetch(`${gatewayUrl}/api/auth/users/${uid}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requester: {
          uid: requester.uid,
          role: requester.role,
          department: requester.department || '',
        },
      }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch (parseError) {
      data = {};
    }

    if (response.ok && data.success) {
      return { success: true };
    }

    return { success: false, error: data.error || 'Failed to delete user' };
  } catch (error) {
    console.error('Error deleting user account:', error);
    return { success: false, error: error.message || 'Failed to delete user' };
  }
};

/**
 * Initialize users (compatibility function)
 * Supabase handles user initialization automatically
 */
export const initializeUsersFile = async () => {
  console.log('✓ Supabase authentication initialized');
};
