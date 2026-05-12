/**
 * SaaS tenant onboarding: company + Management department + super_admin (Auth + public.users).
 *
 * Tenant-isolation contract (enforced end-to-end here):
 *   1. Snapshot existing companies BEFORE any writes (for invariant checks
 *      and to authorize the request).
 *   2. INSERT a brand-new `companies` row. Re-read it by id to confirm the
 *      row really exists and was newly inserted in this request.
 *   3. Reject the onboarding if any user already references this freshly
 *      minted company_id (defence-in-depth against UUID collisions /
 *      concurrent writes via service role).
 *   4. INSERT a Management department whose company_id == the new company.
 *   5. Create the Supabase Auth user with user_metadata.company_id == new
 *      company; create public.users with company_id == new company.
 *   6. Sync auth user_metadata from public.users (single source of truth).
 *   7. Verify the assigned company_id matches everywhere (DB row, auth
 *      metadata after sync) before returning 201. Any mismatch → teardown.
 *
 * There is no fallback to a "first" / "default" company anywhere in this
 * file. Onboarding either creates a fully isolated tenant or fails.
 *
 * First company: no secret. Additional companies: header X-Onboarding-Key
 * must match COMPANY_ONBOARDING_SECRET.
 */
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { normalizeEmailForAuth } = require('../lib/loginNormalize');
const { syncAuthMetadataForUid } = require('../lib/authMetadata');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function countCompanies() {
  const { count, error } = await supabase.from('companies').select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(error.message);
  }
  return typeof count === 'number' ? count : 0;
}

function assertOnboardingAuthorized(req, companyCount) {
  if (companyCount === 0) {
    return;
  }
  const secret = process.env.COMPANY_ONBOARDING_SECRET;
  if (!secret || String(secret).length < 16) {
    const err = new Error(
      'Server onboarding key is not configured. Set COMPANY_ONBOARDING_SECRET (min 16 chars) on the auth-service.'
    );
    err.statusCode = 503;
    throw err;
  }
  const provided = req.get('x-onboarding-key') || req.get('X-Onboarding-Key') || '';
  if (provided !== secret) {
    const err = new Error('Invalid or missing X-Onboarding-Key header');
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Best-effort cleanup after a failed onboarding (service role bypasses RLS).
 * Order: profile row → Auth user → company (CASCADE removes tenant departments).
 */
async function teardownPartialOnboarding({ companyId, authUserId, ts }) {
  if (authUserId) {
    const { error: delProfile } = await supabase.from('users').delete().eq('uid', authUserId);
    if (delProfile) {
      console.error(`[${ts}] [onboard-company] teardown users delete:`, delProfile.message);
    }
    const { error: delAuth } = await supabase.auth.admin.deleteUser(authUserId);
    if (delAuth) {
      console.error(`[${ts}] [onboard-company] teardown auth delete:`, delAuth.message);
    }
  }
  if (companyId) {
    const { error: delCo } = await supabase.from('companies').delete().eq('id', companyId);
    if (delCo) {
      console.error(`[${ts}] [onboard-company] teardown company delete:`, delCo.message);
    }
  }
}

router.get('/onboarding-status', async (req, res) => {
  try {
    const n = await countCompanies();
    return res.json({
      success: true,
      bootstrapAvailable: n === 0,
      requiresOnboardingKey: n > 0,
    });
  } catch (e) {
    console.error('[onboarding] onboarding-status error:', e?.message || e);
    return res.status(500).json({ success: false, error: e.message || 'Failed to read onboarding status' });
  }
});

router.post('/onboard-company', async (req, res) => {
  const ts = new Date().toISOString();
  let companyId = null;
  let departmentId = null;
  let authUserId = null;

  try {
    const companyCount = await countCompanies();
    assertOnboardingAuthorized(req, companyCount);

    console.log(`[${ts}] [onboard-company] pre-insert snapshot`, {
      existing_company_count: companyCount,
      requires_onboarding_key: companyCount > 0,
    });

    const {
      companyName,
      superAdminName,
      username: rawUsername,
      email: rawEmail,
      password,
    } = req.body || {};

    const companyNameTrim = String(companyName ?? '').trim();
    const superAdminNameTrim = String(superAdminName ?? '').trim();
    const username = String(rawUsername ?? '').trim();
    const canonicalEmail = normalizeEmailForAuth(rawEmail);

    if (!companyNameTrim || companyNameTrim.length > 200) {
      return res.status(400).json({ success: false, error: 'Company name is required (max 200 characters).' });
    }
    if (!superAdminNameTrim || superAdminNameTrim.length > 200) {
      return res.status(400).json({ success: false, error: 'Super admin full name is required.' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Username must be 3–64 characters: letters, numbers, dot, underscore, or hyphen.',
      });
    }
    if (!EMAIL_RE.test(canonicalEmail)) {
      return res.status(400).json({ success: false, error: 'Valid email is required.' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const { data: dupEmail, error: emailDupErr } = await supabase
      .from('users')
      .select('id')
      .eq('email', canonicalEmail)
      .maybeSingle();

    if (emailDupErr && emailDupErr.code !== 'PGRST116') {
      console.error(`[${ts}] [onboard-company] email duplicate check error:`, emailDupErr);
      return res.status(500).json({ success: false, error: 'Could not verify email availability.' });
    }
    if (dupEmail) {
      return res.status(409).json({ success: false, error: 'This email is already registered.' });
    }

    const { data: dupUsernameGlobal, error: userGlobalErr } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (userGlobalErr && userGlobalErr.code !== 'PGRST116') {
      console.error(`[${ts}] [onboard-company] username global check error:`, userGlobalErr);
      return res.status(500).json({ success: false, error: 'Could not verify username availability.' });
    }
    if (dupUsernameGlobal) {
      return res.status(409).json({
        success: false,
        error: 'This username is already taken. Choose another, or sign in with email.',
      });
    }

    // STEP 1: Create the NEW company row.
    const { data: companyRow, error: companyErr } = await supabase
      .from('companies')
      .insert({ name: companyNameTrim })
      .select('id, name, created_at')
      .single();

    if (companyErr || !companyRow?.id) {
      console.error(`[${ts}] [onboard-company] company insert failed:`, companyErr?.message);
      return res.status(500).json({ success: false, error: companyErr?.message || 'Failed to create company' });
    }
    companyId = companyRow.id;

    if (!UUID_RE.test(String(companyId))) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: company insert returned non-UUID id`, {
        returned_id: companyId,
      });
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: company row missing a valid UUID id.',
      });
    }

    console.log(`[${ts}] [onboard-company] inserted company`, {
      created_company_id: companyId,
      name: companyNameTrim,
      created_at: companyRow.created_at,
    });

    // STEP 1b: Re-read the company by id and confirm no users are already
    // attached to it. This catches:
    //   - The insert silently returning an existing row id (RLS / RETURNING
    //     edge cases).
    //   - Concurrent writes that beat us to assigning a user to this id.
    const { data: companyReadback, error: companyReadErr } = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', companyId)
      .maybeSingle();

    if (companyReadErr || !companyReadback?.id || String(companyReadback.id) !== String(companyId)) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: cannot re-read created company`, {
        created_company_id: companyId,
        readback_id: companyReadback?.id ?? null,
        readback_error: companyReadErr?.message ?? null,
      });
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: company row could not be verified after insert.',
      });
    }

    const { count: preexistingUserCount, error: preexistingErr } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (preexistingErr) {
      console.error(`[${ts}] [onboard-company] pre-existing user count failed:`, preexistingErr.message);
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: could not verify isolation of new company.',
      });
    }
    if ((preexistingUserCount ?? 0) > 0) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: new company already has users attached`, {
        created_company_id: companyId,
        preexisting_user_count: preexistingUserCount,
      });
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: refused to attach super admin to a company that already has users.',
      });
    }

    // STEP 2: Create the Management department for THIS company.
    const { data: deptRow, error: deptErr } = await supabase
      .from('departments')
      .insert({ name: 'Management', company_id: companyId })
      .select('id, company_id')
      .single();

    if (deptErr || !deptRow?.id) {
      console.error(`[${ts}] [onboard-company] department insert failed:`, deptErr?.message);
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      companyId = null;
      return res.status(500).json({ success: false, error: deptErr?.message || 'Failed to create Management department' });
    }
    departmentId = deptRow.id;

    if (String(deptRow.company_id) !== String(companyId)) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: department.company_id !== new company`, {
        created_company_id: companyId,
        department_company_id: deptRow.company_id,
      });
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: Management department was not bound to the new company.',
      });
    }
    console.log(`[${ts}] [onboard-company] inserted department`, {
      created_department_id: departmentId,
      department_company_id: deptRow.company_id,
      created_company_id: companyId,
    });

    // STEP 3: Create the Supabase Auth user with tenant metadata pinned to
    // the NEW company.
    const initialMeta = {
      username,
      name: superAdminNameTrim,
      company_id: String(companyId),
      role: 'super_admin',
      department_id: String(departmentId),
    };

    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: canonicalEmail,
      password,
      email_confirm: true,
      user_metadata: initialMeta,
    });

    if (authErr || !authUser?.user?.id) {
      console.error(`[${ts}] [onboard-company] auth create failed:`, authErr?.message);
      await teardownPartialOnboarding({ companyId, authUserId: null, ts });
      companyId = null;
      const msg = authErr?.message || 'Failed to create auth user';
      const status =
        /already registered|already exists|already been registered/i.test(msg) ? 409 : 400;
      return res.status(status).json({
        success: false,
        error: status === 409 ? 'This email is already registered in authentication.' : msg,
      });
    }
    authUserId = authUser.user.id;

    // STEP 4: Create the public.users row pinned to the NEW company.
    const hireDate = new Date().toISOString().split('T')[0];

    const { data: profileRow, error: profileErr } = await supabase
      .from('users')
      .insert({
        uid: authUserId,
        username,
        email: canonicalEmail,
        name: superAdminNameTrim,
        role: 'super_admin',
        company_id: companyId,
        department_id: departmentId,
        position: 'Super Admin',
        work_mode: 'in_office',
        hire_date: hireDate,
        is_active: true,
      })
      .select('*')
      .single();

    if (profileErr || !profileRow) {
      console.error(`[${ts}] [onboard-company] users insert failed:`, profileErr?.message);
      await teardownPartialOnboarding({ companyId, authUserId, ts });
      companyId = null;
      authUserId = null;
      const pmsg = profileErr?.message || 'Failed to create user profile';
      const code = /duplicate|unique/i.test(pmsg) ? 409 : 500;
      return res.status(code).json({
        success: false,
        error: pmsg,
      });
    }

    if (String(profileRow.company_id) !== String(companyId)) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: profile.company_id !== inserted company`, {
        profile_company_id: profileRow.company_id,
        created_company_id: companyId,
      });
      await teardownPartialOnboarding({ companyId, authUserId, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: user profile company mismatch',
      });
    }
    if (String(profileRow.department_id) !== String(departmentId)) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: profile.department_id !== inserted department`, {
        profile_department_id: profileRow.department_id,
        created_department_id: departmentId,
      });
      await teardownPartialOnboarding({ companyId, authUserId, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: user profile department mismatch',
      });
    }

    // STEP 5: Sync auth user_metadata from public.users (source of truth)
    // and verify the JWT-facing company_id matches what we just inserted.
    const syncResult = await syncAuthMetadataForUid(supabase, authUserId);
    if (!syncResult.ok) {
      console.error(`[${ts}] [onboard-company] JWT sync failed:`, syncResult.error);
      await teardownPartialOnboarding({ companyId, authUserId, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: could not sync JWT metadata for super admin.',
      });
    }

    const jwtCompany =
      syncResult.row?.company_id != null ? String(syncResult.row.company_id) : null;
    if (jwtCompany !== String(companyId)) {
      console.error(`[${ts}] [onboard-company] INVARIANT FAILED: JWT company_id mismatch after sync`, {
        jwt_company_id_after_sync: jwtCompany,
        created_company_id: companyId,
      });
      await teardownPartialOnboarding({ companyId, authUserId, ts });
      return res.status(500).json({
        success: false,
        error: 'Onboarding invariant failed: JWT company_id does not match newly created company.',
      });
    }

    console.log(`[${ts}] [onboard-company] success`, {
      created_company_id: companyId,
      created_department_id: departmentId,
      assigned_company_id: profileRow.company_id,
      assigned_department_id: profileRow.department_id,
      jwt_company_id_after_sync: jwtCompany,
      auth_user_id: authUserId,
      username,
      preexisting_company_count: companyCount,
    });

    return res.status(201).json({
      success: true,
      company: { id: companyId, name: companyNameTrim },
      department: { id: departmentId, name: 'Management' },
      user: {
        uid: authUserId,
        username,
        email: canonicalEmail,
        role: 'super_admin',
        company_id: String(companyId),
        department_id: String(departmentId),
      },
    });
  } catch (e) {
    const code = e.statusCode || 500;
    if (companyId || authUserId) {
      await teardownPartialOnboarding({ companyId, authUserId, ts });
    }
    console.error(`[${ts}] [onboard-company] error:`, e?.message || e);
    return res.status(code).json({
      success: false,
      error: e.message || 'Onboarding failed',
    });
  }
});

module.exports = router;
