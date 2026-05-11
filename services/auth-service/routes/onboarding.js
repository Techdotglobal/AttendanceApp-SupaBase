/**
 * SaaS tenant onboarding: company + Management department + super_admin (Auth + public.users).
 * First company: no secret. Additional companies: header X-Onboarding-Key must match COMPANY_ONBOARDING_SECRET.
 */
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { normalizeEmailForAuth } = require('../lib/loginNormalize');
const { syncAuthMetadataForUid } = require('../lib/authMetadata');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
async function teardownPartialOnboarding({ companyId, authUserId }) {
  if (authUserId) {
    const { error: delProfile } = await supabase.from('users').delete().eq('uid', authUserId);
    if (delProfile) {
      console.error('[onboarding] teardown users delete:', delProfile.message);
    }
    const { error: delAuth } = await supabase.auth.admin.deleteUser(authUserId);
    if (delAuth) {
      console.error('[onboarding] teardown auth delete:', delAuth.message);
    }
  }
  if (companyId) {
    const { error: delCo } = await supabase.from('companies').delete().eq('id', companyId);
    if (delCo) {
      console.error('[onboarding] teardown company delete:', delCo.message);
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
      console.error('[onboard-company] email duplicate check error:', emailDupErr);
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
      console.error('[onboard-company] username global check error:', userGlobalErr);
      return res.status(500).json({ success: false, error: 'Could not verify username availability.' });
    }
    if (dupUsernameGlobal) {
      return res.status(409).json({
        success: false,
        error: 'This username is already taken. Choose another, or sign in with email.',
      });
    }

    const { data: companyRow, error: companyErr } = await supabase
      .from('companies')
      .insert({ name: companyNameTrim })
      .select('id')
      .single();

    if (companyErr || !companyRow?.id) {
      console.error(`[${ts}] [onboard-company] company insert failed:`, companyErr?.message);
      return res.status(500).json({ success: false, error: companyErr?.message || 'Failed to create company' });
    }
    companyId = companyRow.id;

    const { data: deptRow, error: deptErr } = await supabase
      .from('departments')
      .insert({ name: 'Management', company_id: companyId })
      .select('id')
      .single();

    if (deptErr || !deptRow?.id) {
      console.error(`[${ts}] [onboard-company] department insert failed:`, deptErr?.message);
      await teardownPartialOnboarding({ companyId, authUserId: null });
      companyId = null;
      return res.status(500).json({ success: false, error: deptErr?.message || 'Failed to create Management department' });
    }
    departmentId = deptRow.id;

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
      await teardownPartialOnboarding({ companyId, authUserId: null });
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
      await teardownPartialOnboarding({ companyId, authUserId });
      companyId = null;
      authUserId = null;
      const pmsg = profileErr?.message || 'Failed to create user profile';
      const code = /duplicate|unique/i.test(pmsg) ? 409 : 500;
      return res.status(code).json({
        success: false,
        error: pmsg,
      });
    }

    const syncResult = await syncAuthMetadataForUid(supabase, authUserId);
    if (!syncResult.ok) {
      console.error(`[${ts}] [onboard-company] JWT sync failed (user may need refresh):`, syncResult.error);
    }

    console.log(`[${ts}] [onboard-company] success company=${companyRow.id} user=${username}`);

    return res.status(201).json({
      success: true,
      company: { id: companyRow.id, name: companyNameTrim },
      department: { id: departmentId, name: 'Management' },
      user: {
        uid: authUserId,
        username,
        email: canonicalEmail,
        role: 'super_admin',
        company_id: String(companyRow.id),
        department_id: String(departmentId),
      },
    });
  } catch (e) {
    const code = e.statusCode || 500;
    if (companyId || authUserId) {
      await teardownPartialOnboarding({ companyId, authUserId });
    }
    console.error('[onboard-company] error:', e?.message || e);
    return res.status(code).json({
      success: false,
      error: e.message || 'Onboarding failed',
    });
  }
});

module.exports = router;
