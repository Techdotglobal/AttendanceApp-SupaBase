// Supabase Authentication
import { API_GATEWAY_URL, API_TIMEOUT } from '../core/config/api';
import {
  buildGatewayAuthHeaders,
  resolveCurrentRequester,
  toRequesterContext,
} from '../core/api/gatewayRequest';
import { supabase } from '../core/config/supabase';
import {
  normalizeEmailForAuth,
  parseLoginIdentifier,
  usernameEqVariants,
} from '../core/auth/normalizeLogin';

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
  const { ident, isEmail } = parseLoginIdentifier(usernameOrEmail);

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
  
  // First, try API Gateway (recommended — auth-service uses service role; client anon cannot SELECT users after RLS)
  const GATEWAY_LOGIN_ATTEMPTS = 3;
  const GATEWAY_RETRY_DELAY_MS = 3000;

  /** @type {null | 'http_auth' | 'transport'} */
  let gatewayFailureKind = null;
  let gatewayFailureDetail = null;

  for (let attempt = 0; attempt < GATEWAY_LOGIN_ATTEMPTS; attempt++) {
    gatewayFailureKind = null;
    gatewayFailureDetail = null;
    const gatewayLoginT0 = Date.now();

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
        usernameOrEmail: ident,
        password,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    let data = {};
    try {
      const raw = await response.text();
      data = raw ? JSON.parse(raw) : {};
    } catch (parseErr) {
      gatewayFailureKind = 'transport';
      gatewayFailureDetail = {
        httpStatus: response.status,
        parseError: parseErr?.message || String(parseErr),
      };
    }

    const elapsedMs = Date.now() - gatewayLoginT0;
    console.log('[AUTH] gateway login', {
      attempt: attempt + 1,
      maxAttempts: GATEWAY_LOGIN_ATTEMPTS,
      requestStartMs: gatewayLoginT0,
      elapsedMs,
      apiTimeoutMs: API_TIMEOUT,
      httpStatus: response.status,
      backendReachable: true,
      bodySuccess: data?.success === true,
      jsonParseFailed: gatewayFailureKind === 'transport' && gatewayFailureDetail?.parseError,
    });
    
    // If API Gateway returns success, use it
    if (!gatewayFailureKind && response.ok && data.success) {
      console.log('✓ Authentication successful via API Gateway for:', data.user?.username || ident);
      
      // Gateway must return email — it is required for Supabase session establishment.
      const emailForSession = data.user?.email ? normalizeEmailForAuth(data.user.email) : null;
      if (!emailForSession) {
        console.error('[AUTH] Gateway success but no email in response — cannot establish RLS session');
        return {
          success: false,
          error: 'Authentication error: server did not return required session data.',
          errorKind: 'server_error',
        };
      }

      if (__DEV__) {
        console.log('[AUTH] post-gateway signIn', {
          emailHint: `${emailForSession.slice(0, 2)}***@${emailForSession.split('@')[1]}`,
        });
      }

      const { error: sessionError } = await supabase.auth.signInWithPassword({
        email: emailForSession,
        password,
      });

      if (sessionError) {
        console.error('[AUTH] Supabase session failed after gateway success:', sessionError.message);
        return {
          success: false,
          error: 'Authentication error: could not establish secure session. Please try again.',
          errorKind: 'session_error',
        };
      }

      console.log('✓ Supabase session established for RLS policies');

      return {
        success: true,
        user: {
          username: data.user?.username || ident.split('@')[0],
          role: data.user?.role,
          uid: data.user?.uid || '',
          email: data.user?.email,
          name: data.user?.name,
          department: data.user?.department || '',
          position: data.user?.position || '',
          workMode: data.user?.workMode || 'in_office',
          companyId: data.user?.company_id != null ? String(data.user.company_id) : null,
          departmentId: data.user?.department ? String(data.user.department).trim() : null,
        },
      };
    }

    if (!gatewayFailureKind) {
      if (response.status === 401 || response.status === 400) {
        gatewayFailureKind = 'http_auth';
        gatewayFailureDetail = { httpStatus: response.status, error: data?.error };
      } else if (
        [502, 503, 504, 408].includes(response.status)
        || response.status >= 500
        || !response.ok
      ) {
        gatewayFailureKind = 'transport';
        gatewayFailureDetail = { httpStatus: response.status, error: data?.error };
      } else if (response.ok && !data.success) {
        gatewayFailureKind = 'http_auth';
        gatewayFailureDetail = { httpStatus: response.status, error: data?.error };
      } else {
        gatewayFailureKind = 'transport';
        gatewayFailureDetail = { httpStatus: response.status, reason: 'unexpected_gateway_response' };
      }
    }
  } catch (error) {
    const elapsedMs = Date.now() - gatewayLoginT0;
    const aborted = error?.name === 'AbortError';
    console.warn('[AUTH] gateway login fetch failed', {
      attempt: attempt + 1,
      maxAttempts: GATEWAY_LOGIN_ATTEMPTS,
      requestStartMs: gatewayLoginT0,
      elapsedMs,
      apiTimeoutMs: API_TIMEOUT,
      backendReachable: false,
      timeoutTriggered: aborted,
      errorName: error?.name,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
    gatewayFailureKind = 'transport';
    gatewayFailureDetail = { aborted, errorMessage: error?.message, errorCode: error?.code };
    if (__DEV__ && !aborted) {
      const gw = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'undefined');
      console.log('API Gateway URL attempted:', gw);
      console.log('💡 Tip: Make sure API Gateway is running and URL is correct for your platform');
    }
  }

    if (gatewayFailureKind === 'http_auth') {
      break;
    }
    if (gatewayFailureKind === 'transport' && attempt < GATEWAY_LOGIN_ATTEMPTS - 1) {
      console.log(
        `[AUTH] gateway transport/cold-start issue — retrying in ${GATEWAY_RETRY_DELAY_MS}ms (${attempt + 2}/${GATEWAY_LOGIN_ATTEMPTS})`
      );
      if (attempt === 0) {
        // Surface the cold-start hint to the caller after the first failure so the user
        // sees feedback before the full 3-attempt timeout completes.
        console.log('[AUTH] First gateway attempt failed — server may be waking up (cold start)');
      }
      await new Promise((r) => setTimeout(r, GATEWAY_RETRY_DELAY_MS));
    }
  }

  if (gatewayFailureKind === 'http_auth') {
    return {
      success: false,
      error: gatewayFailureDetail?.error || 'Invalid username or password',
    };
  }

  if (gatewayFailureKind === 'transport' && !isEmail) {
    return {
      success: false,
      error:
        'The login server is waking up or unreachable. Wait 30–60 seconds and try again, or open your backend URL once in a browser to wake the service.',
    };
  }

  // Supabase direct auth — only valid for email-based login.
  // Username→email resolution via anon client is blocked by tenant RLS.
  // Username login with a dead gateway should have been caught above and returned a cold-start error.
  if (!isEmail) {
    return {
      success: false,
      error: 'Server is unavailable. Wait 30–60 seconds and try again, or open the backend URL in a browser to wake the service.',
      errorKind: 'server_unavailable',
    };
  }

  try {
    console.log('[AUTH] Attempting direct Supabase sign-in (email path)...');
    const emailForAuth = normalizeEmailForAuth(ident);

    if (__DEV__) {
      console.log('[AUTH] direct signIn', {
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
        const canon = normalizeEmailForAuth(authData.user.email);
        const { data: userDataByEmail, error: emailError } = await supabase
          .from('users')
          .select('*')
          .eq('email', canon)
          .maybeSingle();
        
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
    
    console.log('✓ Authentication successful via Supabase for:', userData.username || emailForAuth, 'with role:', userData.role);
    return {
      success: true,
      user: {
        username: userData.username || emailForAuth.split('@')[0],
        role: userData.role,
        uid: authData.user.id,
        email: authData.user.email || emailForAuth,
        name: userData.name,
        department: userData.department || '',
        position: userData.position || '',
        workMode: userData.work_mode || 'in_office',
        companyId: userData.company_id != null ? String(userData.company_id) : null,
        departmentId: userData.department ? String(userData.department).trim() : null,
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
      requester: requesterInput,
    } = userData;

    if (!username || !password || !role) {
      return { success: false, error: 'Username, password, and role are required' };
    }
    
    if (!email) {
      return { success: false, error: 'Email is required' };
    }

    const requester = toRequesterContext(requesterInput) || (await resolveCurrentRequester());
    if (!requester) {
      return {
        success: false,
        error: 'You must be signed in as a super admin or manager to create users.',
      };
    }
    
    // Check if username already exists
    const usernameExists = await checkUsernameExists(username);
    if (usernameExists) {
      return { success: false, error: 'Username already exists' };
    }
    
    const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
    const response = await fetch(`${gatewayUrl}/api/auth/users`, {
      method: 'POST',
      headers: buildGatewayAuthHeaders(requester),
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
      }),
    });
    
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    
    if (response.ok && data.success) {
      console.log('✓ User created via API Gateway:', username, `(${role}, ${department || 'No dept'})`);
      return { success: true, uid: data.user?.uid };
    }

    return {
      success: false,
      error: data.error || data.message || 'Failed to create user',
    };
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
    const requester = await resolveCurrentRequester();
    if (!requester) {
      return { success: false, error: 'You must be signed in to update user roles.' };
    }
    // Use API Gateway (recommended)
    try {
      const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || 'http://localhost:3000');
      const response = await fetch(`${gatewayUrl}/api/auth/users/${username}/role`, {
        method: 'PATCH',
        headers: buildGatewayAuthHeaders(requester),
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
    const requester = await resolveCurrentRequester();
    if (!requester) {
      return { success: false, error: 'You must be signed in to update user information.' };
    }
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
        headers: buildGatewayAuthHeaders(requester),
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
    const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
    if (!ctx) {
      return { success: false, error: 'Requester context is required' };
    }

    const gatewayUrl = typeof API_GATEWAY_URL === 'string'
      ? API_GATEWAY_URL
      : String(API_GATEWAY_URL || 'http://localhost:3000');

    const response = await fetch(`${gatewayUrl}/api/auth/users/${uid}`, {
      method: 'DELETE',
      headers: buildGatewayAuthHeaders(ctx),
      body: JSON.stringify({
        requester: {
          uid: ctx.uid,
          role: ctx.role,
          department: ctx.department || '',
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
