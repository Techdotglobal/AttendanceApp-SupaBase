const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { syncAuthMetadataForUid } = require('../lib/authMetadata');
const {
  normalizeEmailForAuth,
  parseLoginIdentifier,
  usernameEqVariants,
} = require('../lib/loginNormalize');
const { normalizePosition } = require('../lib/orgNormalize');
const {
  listDepartmentsForCompany,
  ensureDepartmentForCompany,
} = require('../lib/departmentService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVILEGED_ROLES = new Set(['super_admin', 'manager']);

/**
 * Parse X-User-Context (caller identity injected by the api-gateway from the
 * web/mobile auth store). Required for any route that mutates tenant data.
 * @param {import('express').Request} req
 * @returns {{ uid?: string, role?: string, company_id?: string, companyId?: string, department?: string } | null}
 */
function parseRequester(req) {
  const raw = req.get('x-user-context') || req.get('X-User-Context');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the caller tenant. Prefers the requester's company_id from
 * X-User-Context; if absent, reads it from public.users by uid. Returns null
 * when the caller cannot be tied to a tenant.
 * @returns {Promise<string|null>}
 */
async function resolveRequesterCompanyId(requester) {
  if (!requester) return null;
  const direct = requester.company_id ?? requester.companyId;
  if (direct && UUID_RE.test(String(direct))) {
    return String(direct);
  }
  if (!requester.uid) return null;
  const { data, error } = await supabase
    .from('users')
    .select('company_id')
    .eq('uid', requester.uid)
    .maybeSingle();
  if (error || !data?.company_id) return null;
  return UUID_RE.test(String(data.company_id)) ? String(data.company_id) : null;
}

/**
 * Ensure tenant department catalog row exists; return display name for users.department (TEXT).
 * Does not write users.department_id — schema uses department TEXT only for now.
 * @returns {Promise<string>} normalized department display name or ''
 */
async function resolveDepartmentForUserCreate(companyId, departmentName) {
  const trimmed = departmentName != null ? String(departmentName).trim() : '';
  if (!trimmed || !companyId) {
    return '';
  }
  const ensured = await ensureDepartmentForCompany(companyId, trimmed);
  if (!ensured) {
    return '';
  }
  return ensured.name;
}

/**
 * POST /api/auth/login
 * Authenticate user with username/email and password
 * Body: { usernameOrEmail: string, password: string }
 * 
 * Implementation:
 * 1. If username, resolve email using Supabase database query
 * 2. Authenticate using Supabase Auth (signInWithPassword)
 * 3. Fetch user data from Supabase database
 * 4. Return user info
 */
router.post('/login', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { usernameOrEmail, password } = req.body || {};
  const { ident, isEmail } = parseLoginIdentifier(usernameOrEmail);
  console.log(`[${timestamp}] Auth Service: Login request`, {
    hasIdentifier: Boolean(ident),
    isEmail,
    identifierPreview: isEmail
      ? `${ident.slice(0, 2)}***@${ident.split('@')[1] || ''}`
      : ident,
  });

  try {
    if (!ident || !password) {
      console.log(`[${timestamp}] Auth Service: Login failed - missing credentials`);
      return res.status(400).json({
        success: false,
        error: 'Username/email and password are required',
      });
    }

    let emailForAuth;

    if (!isEmail) {
      try {
        let resolved = null;
        const variants = usernameEqVariants(ident);
        for (const u of variants) {
          const { data: row, error: qErr } = await supabase
            .from('users')
            .select('email, username')
            .eq('username', u)
            .maybeSingle();
          if (qErr) {
            console.warn(`[${timestamp}] Auth Service: username lookup error`, { username: u, message: qErr.message });
          }
          if (row?.email) {
            resolved = row;
            break;
          }
        }

        if (!resolved?.email) {
          console.log(`[${timestamp}] Auth Service: ✗ User not found for username variants`, { variants });
          return res.status(401).json({
            success: false,
            error: 'Invalid username or password',
          });
        }

        emailForAuth = normalizeEmailForAuth(resolved.email);
      } catch (queryError) {
        console.error('Database query error:', queryError.message);
        return res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }
    } else {
      emailForAuth = normalizeEmailForAuth(ident);
    }

    // Step 2: Authenticate using Supabase Auth (email must match GoTrue canonical lowercased form)
    try {
      console.log(`[${timestamp}] Auth Service: signInWithPassword`, {
        emailHint: `${emailForAuth.slice(0, 2)}***@${emailForAuth.split('@')[1] || ''}`,
      });

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: emailForAuth,
        password,
      });
      
      if (authError || !authData.user) {
        // Handle authentication errors
        if (authError?.message?.includes('Invalid login credentials') || 
            authError?.message?.includes('Email not confirmed')) {
          console.log(`[${timestamp}] Auth Service: ✗ signIn rejected`, {
            code: authError?.status,
            message: authError?.message,
          });
          return res.status(401).json({
            success: false,
            error: 'Invalid username or password',
          });
        }
        
        if (authError?.message?.includes('Email rate limit exceeded')) {
          console.log('✗ Authentication failed: Too many attempts');
          return res.status(429).json({
            success: false,
            error: 'Too many failed attempts. Please try again later',
          });
        }
        
        console.error('Supabase Auth error:', authError?.message);
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: authError?.message,
        });
      }
      
      const userId = authData.user.id;
      
      // Step 3: Fetch user data from Supabase database
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('uid', userId)
        .single();
      
      if (userError || !userData) {
        console.log('✗ Authentication failed: User data not found in database');
        return res.status(401).json({
          success: false,
          error: 'User data not found',
        });
      }
      
      console.log(`[${timestamp}] Auth Service: ✓ Authentication successful for:`, userData.username || emailForAuth, 'with role:', userData.role);

      const metaSync = await syncAuthMetadataForUid(supabase, userId);
      if (!metaSync.ok) {
        console.error(`[${timestamp}] Auth Service: JWT user_metadata sync failed after login:`, metaSync.error);
      }

      // Step 4: Return user info (tenant fields mirror DB; client also refreshes JWT)
      return res.status(200).json({
        success: true,
        user: {
          uid: userId,
          username: userData.username || emailForAuth.split('@')[0],
          email: userData.email || emailForAuth,
          role: userData.role,
          name: userData.name,
          department: userData.department || '',
          position: userData.position || '',
          workMode: userData.work_mode || 'in_office',
          company_id: userData.company_id != null ? String(userData.company_id) : null,
        },
      });
    } catch (authError) {
      console.error('Authentication error:', authError);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: authError.message,
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /api/auth/sync-metadata
 * Bearer: current access_token. Rebuilds user_metadata from public.users (service role).
 * Used when JWT tenant claims are missing or stale after role/department/company changes.
 */
router.post('/sync-metadata', async (req, res) => {
  const timestamp = new Date().toISOString();
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    console.warn(`[${timestamp}] Auth Service: sync-metadata missing bearer token`);
    return res.status(401).json({
      success: false,
      error: 'Missing Authorization: Bearer <access_token>',
    });
  }

  try {
    const { data: userResult, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userResult?.user?.id) {
      console.error(`[${timestamp}] Auth Service: sync-metadata invalid token`, userErr?.message);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session',
      });
    }

    const syncResult = await syncAuthMetadataForUid(supabase, userResult.user.id);
    if (!syncResult.ok) {
      console.error(`[${timestamp}] Auth Service: sync-metadata failed`, syncResult.error);
      return res.status(500).json({
        success: false,
        error: syncResult.error || 'Failed to sync metadata',
      });
    }

    console.log(`[${timestamp}] Auth Service: ✓ sync-metadata for uid`, userResult.user.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('sync-metadata error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /api/auth/check-username/:username
 * Check if username exists
 */
router.get('/check-username/:username', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  console.log(`[${timestamp}] Auth Service: Check username request for: ${username}`);
  
  try {
    if (!username) {
      console.log(`[${timestamp}] Auth Service: Check username failed - username missing`);
      return res.status(400).json({
        success: false,
        error: 'Username is required',
      });
    }

    // Query Supabase database
    const { data, error } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .limit(1);

    if (error) {
      console.error('Check username error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }

    return res.status(200).json({
      success: true,
      exists: data && data.length > 0,
    });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /api/auth/users
 * Create a new user
 * Body: { username, password, email, name, role, department, position, workMode, hireDate }
 */
router.post('/users', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Auth Service: Create user request received for:`, req.body.username || 'unknown');

  try {
    const {
      username,
      password,
      email,
      name,
      role,
      department,
      position,
      workMode,
      hireDate,
    } = req.body;

    if (!username || !password || !email || !role) {
      console.log(`[${timestamp}] Auth Service: Create user failed - missing required fields`);
      return res.status(400).json({
        success: false,
        error: 'Username, password, email, and role are required',
      });
    }

    if (String(role).toLowerCase() === 'super_admin') {
      return res.status(403).json({
        success: false,
        error:
          'Creating super_admin accounts is only allowed via POST /api/auth/onboard-company (tenant onboarding).',
      });
    }

    // Tenant guard: caller must be authenticated (X-User-Context), in a
    // privileged role, and we pin company_id to the caller's tenant — never
    // trust a client-supplied company_id (prevents cross-tenant injection).
    const requester = parseRequester(req);
    if (!requester || !requester.role) {
      return res.status(401).json({
        success: false,
        error: 'Missing requester identity (X-User-Context).',
      });
    }
    if (!PRIVILEGED_ROLES.has(String(requester.role))) {
      return res.status(403).json({
        success: false,
        error: 'Only super admins or managers can create users.',
      });
    }
    const companyId = await resolveRequesterCompanyId(requester);
    if (!companyId) {
      return res.status(403).json({
        success: false,
        error: 'Caller is not bound to a tenant (company_id missing). Re-login or update the client.',
      });
    }
    // Managers can only create employees (no manager/super_admin escalation).
    if (requester.role === 'manager' && String(role).toLowerCase() !== 'employee') {
      return res.status(403).json({
        success: false,
        error: 'Managers can only create users with role "employee".',
      });
    }
    // If the client supplied a different company_id, reject (signal of bug or attack).
    const suppliedCompany = req.body.company_id ?? req.body.companyId;
    if (suppliedCompany && String(suppliedCompany) !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'company_id mismatch with authenticated tenant.',
      });
    }

    const canonicalEmail = normalizeEmailForAuth(email);

    // Tenant-scoped duplicate checks (username unique within tenant; email
    // unique globally because Supabase Auth is project-wide).
    const { data: dupEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', canonicalEmail)
      .maybeSingle();
    if (dupEmail) {
      return res.status(409).json({ success: false, error: 'Email already exists.' });
    }
    const { data: dupUsername } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .eq('company_id', companyId)
      .maybeSingle();
    if (dupUsername) {
      return res.status(409).json({ success: false, error: 'Username already taken.' });
    }

    const resolvedDepartmentName = await resolveDepartmentForUserCreate(companyId, department);
    const normalizedPosition = position ? normalizePosition(position) : '';

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: canonicalEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        username,
        name: name || username,
        company_id: companyId,
        role,
        department: resolvedDepartmentName || '',
      },
    });

    if (authError) {
      if (authError.message?.includes('already registered') ||
          authError.message?.includes('already exists')) {
        return res.status(409).json({
          success: false,
          error: 'Email already exists',
        });
      }

      if (authError.message?.includes('Invalid email')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email address',
        });
      }

      console.error('Create user auth error:', authError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create user',
        message: authError.message,
      });
    }

    const { data: userData, error: dbError } = await supabase
      .from('users')
      .insert({
        uid: authUser.user.id,
        username: username,
        email: canonicalEmail,
        name: name || username,
        role: role,
        company_id: companyId,
        department: resolvedDepartmentName || '',
        position: normalizedPosition || '',
        work_mode: workMode || 'in_office',
        hire_date: hireDate || new Date().toISOString().split('T')[0],
        is_active: true,
      })
      .select()
      .single();

    if (dbError) {
      await supabase.auth.admin.deleteUser(authUser.user.id);

      console.error('Create user database error:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create user profile',
        message: dbError.message,
      });
    }

    const metaSync = await syncAuthMetadataForUid(supabase, authUser.user.id);
    if (!metaSync.ok) {
      console.error(`[${timestamp}] Auth Service: JWT metadata sync failed after create:`, metaSync.error);
    }

    console.log(`[${timestamp}] Auth Service: ✓ User created:`, username, 'company:', companyId, 'role:', role);

    return res.status(201).json({
      success: true,
      user: {
        uid: authUser.user.id,
        username: username,
        email: canonicalEmail,
        role: role,
        name: name || username,
        department: userData.department || '',
        position: normalizedPosition || userData.position || '',
        workMode: workMode || 'in_office',
        company_id: userData.company_id != null ? String(userData.company_id) : String(companyId),
      },
    });
  } catch (error) {
    console.error('Create user error:', error);

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/auth/users/:uid
 * Delete user from Supabase Auth and PostgreSQL users table
 * Body: { requester: { uid, role, department } }
 */
router.delete('/users/:uid', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { uid } = req.params;
  const { requester } = req.body || {};
  console.log(`[${timestamp}] Auth Service: Delete user request for uid: ${uid}`);

  try {
    if (!uid) {
      return res.status(400).json({
        success: false,
        error: 'User uid is required',
      });
    }

    if (!requester || !requester.uid || !requester.role) {
      return res.status(400).json({
        success: false,
        error: 'Requester context is required',
      });
    }

    // Fetch target user for permission checks
    const { data: targetUser, error: targetUserError } = await supabase
      .from('users')
      .select('uid, role, department, username')
      .eq('uid', uid)
      .single();

    if (targetUserError || !targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Authorization rules:
    // - super_admin cannot delete any super_admin accounts (never allowed)
    // - HR manager can delete employees + managers, but not super_admin
    const isSuperAdmin = requester.role === 'super_admin';
    const isHrManager = requester.role === 'manager' && requester.department === 'HR';

    if (!isSuperAdmin && !isHrManager) {
      return res.status(403).json({
        success: false,
        error: 'Permission denied',
      });
    }

    // Safety: super_admin accounts cannot be deleted by anyone.
    if (targetUser.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Super Admin accounts cannot be deleted',
      });
    }

    // Prevent deleting your own account for safety (applies to non-super-admin users)
    if (requester.uid === uid) {
      return res.status(403).json({
        success: false,
        error: 'You cannot delete your own account',
      });
    }

    // HR managers can delete employees and managers (any department),
    // as long as the target is NOT a super_admin (handled above).
    if (isHrManager) {
      if (!['employee', 'manager'].includes(targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: 'HR managers can only delete employee/manager accounts',
        });
      }
    }

    // 1) Delete from Supabase Auth
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(uid);
    if (authDeleteError) {
      console.error('Delete auth user error:', authDeleteError);
      return res.status(500).json({
        success: false,
        error: authDeleteError.message || 'Failed to delete user from authentication',
      });
    }

    // 2) Delete from PostgreSQL users table
    const { error: dbDeleteError } = await supabase
      .from('users')
      .delete()
      .eq('uid', uid);

    if (dbDeleteError) {
      console.error('Delete user profile error:', dbDeleteError);
      return res.status(500).json({
        success: false,
        error: dbDeleteError.message || 'Failed to delete user profile',
      });
    }

    console.log(`[${timestamp}] Auth Service: ✓ User deleted: ${targetUser.username || uid}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * PATCH /api/auth/users/:username/role
 * Update user role
 * Body: { role: string }
 */
router.patch('/users/:username/role', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  const { role } = req.body;
  console.log(`[${timestamp}] Auth Service: Update role request for: ${username} -> ${role}`);
  
  try {
    if (!username || !role) {
      console.log(`[${timestamp}] Auth Service: Update role failed - missing username or role`);
      return res.status(400).json({
        success: false,
        error: 'Username and role are required',
      });
    }

    if (String(role).toLowerCase() === 'super_admin') {
      return res.status(403).json({
        success: false,
        error:
          'Assigning super_admin is only supported via POST /api/auth/onboard-company (tenant onboarding).',
      });
    }

    // Update role in Supabase database
    const { data, error } = await supabase
      .from('users')
      .update({ 
        role: role,
        updated_at: new Date().toISOString(),
      })
      .eq('username', username)
      .select();

    if (error) {
      console.error('Update role error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const targetUid = data[0].uid;
    const metaSync = await syncAuthMetadataForUid(supabase, targetUid);
    if (!metaSync.ok) {
      console.error(`[${timestamp}] Auth Service: JWT metadata sync failed after role update:`, metaSync.error);
    }

    console.log(`[${timestamp}] Auth Service: ✓ User role updated:`, username, 'to', role);

    return res.status(200).json({
      success: true,
      message: 'User role updated successfully',
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PATCH /api/auth/users/:username/email
 * Update user email (requires admin privileges)
 * Body: { email: string }
 */
router.patch('/users/:username/email', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  const { email } = req.body;
  
  console.log(`[${timestamp}] Auth Service: Update email request for: ${username} -> ${email}`);
  
  try {
    if (!username || !email) {
      return res.status(400).json({
        success: false,
        error: 'Username and email are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    // Step 1: Get user's UID from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('uid, email')
      .eq('username', username)
      .single();

    if (userError || !userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Step 2: Update email in Supabase Auth (requires admin API)
    const { data: authData, error: authError } = await supabase.auth.admin.updateUserById(
      userData.uid,
      {
        email: email,
        email_confirm: true, // Auto-confirm the new email
      }
    );

    if (authError) {
      console.error('Update email in Auth error:', authError);
      return res.status(500).json({
        success: false,
        error: authError.message || 'Failed to update email in Auth',
      });
    }

    // Step 3: Update email in PostgreSQL users table
    const { data: dbData, error: dbError } = await supabase
      .from('users')
      .update({
        email: email,
        updated_at: new Date().toISOString(),
      })
      .eq('username', username)
      .select();

    if (dbError) {
      console.error('Update email in database error:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Failed to update email in database',
      });
    }

    console.log(`[${timestamp}] Auth Service: ✓ User email updated: ${username} -> ${email}`);

    return res.status(200).json({
      success: true,
      message: 'Email updated successfully',
      data: {
        username: username,
        oldEmail: userData.email,
        newEmail: email,
      },
    });
  } catch (error) {
    console.error('Update email error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PATCH /api/auth/users/:username
 * Update user information
 * Body: { ...updates }
 */
router.patch('/users/:username', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  const updates = req.body;
  console.log(`[${timestamp}] Auth Service: Update user request for: ${username}`, { updates: Object.keys(updates) });
  
  try {
    if (!username) {
      console.log(`[${timestamp}] Auth Service: Update user failed - username missing`);
      return res.status(400).json({
        success: false,
        error: 'Username is required',
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      console.log(`[${timestamp}] Auth Service: Update user failed - no update data`);
      return res.status(400).json({
        success: false,
        error: 'Update data is required',
      });
    }

    // Convert camelCase to snake_case for database fields
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
    
    // Copy other fields as-is (they should already be in correct format)
    Object.keys(updates).forEach(key => {
      if (!['workMode', 'hireDate', 'isActive'].includes(key)) {
        dbUpdates[key] = updates[key];
      }
    });
    
    dbUpdates.updated_at = new Date().toISOString();

    if (dbUpdates.role !== undefined && String(dbUpdates.role).toLowerCase() === 'super_admin') {
      return res.status(403).json({
        success: false,
        error:
          'Assigning super_admin is only supported via POST /api/auth/onboard-company (tenant onboarding).',
      });
    }

    // Update user data in Supabase database
    const { data, error } = await supabase
      .from('users')
      .update(dbUpdates)
      .eq('username', username)
      .select();

    if (error) {
      console.error('Update user error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const targetUid = data[0].uid;
    const metaSync = await syncAuthMetadataForUid(supabase, targetUid);
    if (!metaSync.ok) {
      console.error(`[${timestamp}] Auth Service: JWT metadata sync failed after profile update:`, metaSync.error);
    }

    console.log(`[${timestamp}] Auth Service: ✓ User info updated:`, username);

    return res.status(200).json({
      success: true,
      message: 'User information updated successfully',
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/auth/departments
 * Tenant-scoped department list for employee creation UI.
 */
router.get('/departments', async (req, res) => {
  const requester = parseRequester(req);
  if (!requester || !requester.role) {
    return res.status(401).json({
      success: false,
      error: 'Missing requester identity (X-User-Context).',
    });
  }
  if (!PRIVILEGED_ROLES.has(String(requester.role))) {
    return res.status(403).json({
      success: false,
      error: 'Only super admins or managers can list departments.',
    });
  }
  const companyId = await resolveRequesterCompanyId(requester);
  if (!companyId) {
    return res.status(403).json({
      success: false,
      error: 'Caller is not bound to a tenant (company_id missing).',
    });
  }
  try {
    let departments = await listDepartmentsForCompany(companyId);
    if (requester.role === 'manager' && requester.department) {
      const mgrDept = String(requester.department).trim().toLowerCase();
      departments = departments.filter(
        (d) => String(d.name).trim().toLowerCase() === mgrDept
      );
    }
    return res.status(200).json({ success: true, data: departments });
  } catch (error) {
    console.error('List departments error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to list departments',
    });
  }
});

/**
 * GET /api/auth/position-suggestions
 * Distinct normalized positions already used in this tenant (for autocomplete).
 */
router.get('/position-suggestions', async (req, res) => {
  const requester = parseRequester(req);
  if (!requester || !requester.role) {
    return res.status(401).json({
      success: false,
      error: 'Missing requester identity (X-User-Context).',
    });
  }
  if (!PRIVILEGED_ROLES.has(String(requester.role))) {
    return res.status(403).json({
      success: false,
      error: 'Only super admins or managers can list position suggestions.',
    });
  }
  const companyId = await resolveRequesterCompanyId(requester);
  if (!companyId) {
    return res.status(403).json({
      success: false,
      error: 'Caller is not bound to a tenant (company_id missing).',
    });
  }
  try {
    const { data, error } = await supabase
      .from('users')
      .select('position')
      .eq('company_id', companyId)
      .not('position', 'is', null);

    if (error) throw error;

    const seen = new Set();
    const suggestions = [];
    for (const row of data || []) {
      const normalized = normalizePosition(row.position);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(normalized);
    }
    suggestions.sort((a, b) => a.localeCompare(b));

    return res.status(200).json({ success: true, data: suggestions });
  } catch (error) {
    console.error('Position suggestions error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to load position suggestions',
    });
  }
});

const onboardingRoutes = require('./onboarding');
router.use(onboardingRoutes);

module.exports = router;
