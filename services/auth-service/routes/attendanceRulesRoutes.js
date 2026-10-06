const express = require('express');
const { supabase } = require('../config/supabase');
const { resolveRequester } = require('../lib/resolveRequester');
const { hasPermission, requirePermission, resolveScopedUserUids, writeAuthorizationAudit, getUserDepartmentIds } = require('../lib/permissions');
const { reconcileAbsenceOutcome } = require('../lib/attendanceAbsenceService');

const router = express.Router();

async function tenant(req, res) {
  const requester = await resolveRequester(req);
  if (!requester?.uid) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return null;
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('uid, username, name, role, company_id, department_id, department, is_active')
    .eq('uid', requester.uid)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !user?.company_id) {
    res.status(403).json({ success: false, error: 'Tenant scope required' });
    return null;
  }
  return { requester: user, companyId: user.company_id };
}

async function requireRulesAdmin(ctx, res) {
  return requirePermission(supabase, ctx.requester, 'manage_attendance_rules', res);
}

function normalizeRule(body, companyId, actorUid, existing = {}) {
  const scope = String(body.scope_type || body.scopeType || existing.scope_type || 'COMPANY').toUpperCase();
  if (!['COMPANY', 'DEPARTMENT', 'USER'].includes(scope)) throw new Error('Invalid schedule scope_type');
  const departmentId = body.department_id ?? body.departmentId ?? existing.department_id ?? null;
  const userUid = body.user_uid ?? body.userUid ?? existing.user_uid ?? null;
  if (scope === 'COMPANY' && (departmentId || userUid)) throw new Error('Company schedules cannot target a department or user');
  if (scope === 'DEPARTMENT' && !departmentId) throw new Error('Department schedules require department_id');
  if (scope === 'USER' && !userUid) throw new Error('User schedules require user_uid');
  const workingDays = body.working_days ?? body.workingDays ?? existing.working_days ?? [1, 2, 3, 4, 5];
  if (!Array.isArray(workingDays) || workingDays.some((day) => !Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 7)) throw new Error('working_days must contain ISO weekdays 1-7');
  return {
    company_id: companyId,
    scope_type: scope,
    department_id: scope === 'DEPARTMENT' ? departmentId : null,
    user_uid: scope === 'USER' ? userUid : null,
    timezone: String(body.timezone ?? existing.timezone ?? 'UTC'),
    scheduled_start: body.scheduled_start ?? body.scheduledStart ?? existing.scheduled_start,
    scheduled_end: body.scheduled_end ?? body.scheduledEnd ?? existing.scheduled_end,
    grace_minutes: Number(body.grace_minutes ?? body.graceMinutes ?? existing.grace_minutes ?? 0),
    working_days: workingDays.map(Number),
    overtime_enabled: Boolean(body.overtime_enabled ?? body.overtimeEnabled ?? existing.overtime_enabled ?? false),
    overtime_window_minutes: Number(body.overtime_window_minutes ?? body.overtimeWindowMinutes ?? existing.overtime_window_minutes ?? 0),
    auto_checkout_enabled: body.auto_checkout_enabled !== undefined ? Boolean(body.auto_checkout_enabled) : (existing.auto_checkout_enabled !== false),
    effective_from: body.effective_from ?? body.effectiveFrom ?? existing.effective_from,
    effective_to: body.effective_to ?? body.effectiveTo ?? existing.effective_to ?? null,
    version: Number(body.version ?? existing.version ?? 1),
    updated_by_uid: actorUid,
    ...(existing.id ? {} : { created_by_uid: actorUid }),
  };
}

router.get('/attendance/rules', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  try {
    const { data, error } = await supabase.from('attendance_schedule_rules').select('*').eq('company_id', ctx.companyId).order('effective_from', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/attendance/rules', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  try {
    const payload = normalizeRule(req.body || {}, ctx.companyId, ctx.requester.uid);
    if (!payload.scheduled_start || !payload.scheduled_end || !payload.effective_from) throw new Error('scheduled_start, scheduled_end, and effective_from are required');
    const { data, error } = await supabase.from('attendance_schedule_rules').insert(payload).select('*').single();
    if (error) throw error;
    await writeAuthorizationAudit(supabase, {
      companyId: ctx.companyId,
      actorUid: ctx.requester.uid,
      action: 'attendance_schedule_rule_created',
      afterState: data,
    });
    res.status(201).json({ success: true, data });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.patch('/attendance/rules/:id', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  try {
    const { data: existing, error: findError } = await supabase.from('attendance_schedule_rules').select('*').eq('id', req.params.id).eq('company_id', ctx.companyId).maybeSingle();
    if (findError) throw findError;
    if (!existing) return res.status(404).json({ success: false, error: 'Schedule rule not found' });
    const payload = normalizeRule(req.body || {}, ctx.companyId, ctx.requester.uid, existing);
    payload.version = Number(existing.version || 1) + 1;
    const { data, error } = await supabase.from('attendance_schedule_rules').update(payload).eq('id', existing.id).eq('company_id', ctx.companyId).select('*').single();
    if (error) throw error;
    await writeAuthorizationAudit(supabase, {
      companyId: ctx.companyId,
      actorUid: ctx.requester.uid,
      action: 'attendance_schedule_rule_updated',
      beforeState: existing,
      afterState: data,
    });
    res.json({ success: true, data });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/attendance/rules/:id', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  const { data: existing } = await supabase.from('attendance_schedule_rules').select('*').eq('id', req.params.id).eq('company_id', ctx.companyId).maybeSingle();
  const { error } = await supabase.from('attendance_schedule_rules').delete().eq('id', req.params.id).eq('company_id', ctx.companyId);
  if (error) return res.status(400).json({ success: false, error: error.message });
  if (existing) await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'attendance_schedule_rule_deleted',
    beforeState: existing,
  });
  res.json({ success: true });
});

router.get('/attendance/holidays', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  try {
    const { data, error } = await supabase.from('attendance_holidays').select('*').eq('company_id', ctx.companyId).order('holiday_date', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/attendance/holidays', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  const { holiday_date, name, holiday_type = 'public', is_working_day = false } = req.body || {};
  if (!holiday_date || !name?.trim()) return res.status(400).json({ success: false, error: 'holiday_date and name are required' });
  const { data, error } = await supabase.from('attendance_holidays').insert({ company_id: ctx.companyId, holiday_date, name: name.trim(), holiday_type, is_working_day: Boolean(is_working_day), created_by_uid: ctx.requester.uid, updated_by_uid: ctx.requester.uid }).select('*').single();
  if (error) return res.status(400).json({ success: false, error: error.message });
  await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'attendance_holiday_created',
    afterState: data,
  });
  res.status(201).json({ success: true, data });
});

router.patch('/attendance/holidays/:id', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  const { data: existing } = await supabase.from('attendance_holidays').select('*').eq('id', req.params.id).eq('company_id', ctx.companyId).maybeSingle();
  const updates = { updated_by_uid: ctx.requester.uid };
  for (const key of ['holiday_date', 'name', 'holiday_type']) if (req.body[key] !== undefined) updates[key] = req.body[key];
  if (req.body.is_working_day !== undefined) updates.is_working_day = Boolean(req.body.is_working_day);
  const { data, error } = await supabase.from('attendance_holidays').update(updates).eq('id', req.params.id).eq('company_id', ctx.companyId).select('*').maybeSingle();
  if (error) return res.status(400).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Holiday not found' });
  await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'attendance_holiday_updated',
    beforeState: existing || {},
    afterState: data,
  });
  res.json({ success: true, data });
});

router.delete('/attendance/holidays/:id', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx || !(await requireRulesAdmin(ctx, res))) return;
  const { data: existing } = await supabase.from('attendance_holidays').select('*').eq('id', req.params.id).eq('company_id', ctx.companyId).maybeSingle();
  const { error } = await supabase.from('attendance_holidays').delete().eq('id', req.params.id).eq('company_id', ctx.companyId);
  if (error) return res.status(400).json({ success: false, error: error.message });
  if (existing) await writeAuthorizationAudit(supabase, {
    companyId: ctx.companyId,
    actorUid: ctx.requester.uid,
    action: 'attendance_holiday_deleted',
    beforeState: existing,
  });
  res.json({ success: true });
});

router.get('/attendance/summaries', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx) return;
  try {
    const own = ctx.requester.role === 'employee';
    const canView = await hasPermission(supabase, ctx.requester, 'view_attendance');
    if (!own && !canView && ctx.requester.role !== 'super_admin') return res.status(403).json({ success: false, error: 'Permission required: view_attendance' });
    let query = supabase.from('attendance_daily_summaries').select('*').eq('company_id', ctx.companyId).order('work_date', { ascending: false });
    if (ctx.requester.role === 'super_admin') {
      // Tenant-wide access remains the existing super-admin behavior.
    } else if (own && !canView) {
      query = query.eq('user_uid', ctx.requester.uid);
    } else {
      const visibleUids = await resolveScopedUserUids(supabase, ctx.requester, ctx.companyId, 'view_attendance');
      const scoped = visibleUids?.length ? visibleUids : ['00000000-0000-0000-0000-000000000000'];
      query = query.in('user_uid', scoped);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/attendance/absence-outcomes', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx) return;
  const own = ctx.requester.role === 'employee';
  const canView = await hasPermission(supabase, ctx.requester, 'view_attendance');
  if (!own && !canView && ctx.requester.role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Permission required: view_attendance' });
  }
  try {
    let query = supabase.from('attendance_absence_outcomes').select('*').eq('company_id', ctx.companyId).order('work_date', { ascending: false });
    if (ctx.requester.role === 'super_admin') {
      // Tenant-wide access remains the existing super-admin behavior.
    } else if (own && !canView) {
      query = query.eq('user_uid', ctx.requester.uid);
    } else {
      const visibleUids = await resolveScopedUserUids(supabase, ctx.requester, ctx.companyId, 'view_attendance');
      query = query.in('user_uid', visibleUids?.length ? visibleUids : ['00000000-0000-0000-0000-000000000000']);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) { res.status(500).json({ success: false, error: error.message || 'Failed to fetch absence outcomes' }); }
});

async function loadScopedAbsenceOutcome(ctx, id) {
  const { data: outcome, error } = await supabase
    .from('attendance_absence_outcomes')
    .select('*')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (error) throw error;
  if (!outcome) return null;
  if (ctx.requester.role === 'super_admin' || String(outcome.user_uid) === String(ctx.requester.uid)) return outcome;
  const target = await supabase.from('users')
      .select('uid, department_id, department, is_active')
      .eq('company_id', ctx.companyId)
      .eq('uid', outcome.user_uid)
      .maybeSingle();
  if (target.error) throw target.error;
  const targetDepartmentIds = target.data ? await getUserDepartmentIds(supabase, target.data.uid, target.data) : [];
  if (!target.data || !(await hasPermission(supabase, ctx.requester, 'view_attendance', {
    companyId: ctx.companyId,
    targetUid: target.data.uid,
    userUid: target.data.uid,
    departmentId: target.data.department_id,
    departmentIds: targetDepartmentIds,
    department: target.data.department,
  }))) return null;
  return outcome;
}

router.get('/attendance/absence-outcomes/:id', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx) return;
  try {
    const outcome = await loadScopedAbsenceOutcome(ctx, req.params.id);
    if (!outcome) return res.status(404).json({ success: false, error: 'Absence outcome not found' });
    const { data: ledger, error } = await supabase
      .from('leave_balance_adjustments')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('outcome_id', outcome.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ success: true, data: { outcome, ledger: ledger || [] } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch absence outcome' });
  }
});

router.post('/attendance/absence-outcomes/:id/reconcile', async (req, res) => {
  const ctx = await tenant(req, res); if (!ctx) return;
  try {
    const outcome = await loadScopedAbsenceOutcome(ctx, req.params.id);
    if (!outcome) return res.status(404).json({ success: false, error: 'Absence outcome not found' });
    const target = await supabase.from('users')
      .select('uid, department_id, department, is_active')
      .eq('company_id', ctx.companyId)
      .eq('uid', outcome.user_uid)
      .maybeSingle();
    if (target.error) throw target.error;
    const targetDepartmentIds = target.data ? await getUserDepartmentIds(supabase, target.data.uid, target.data) : [];
    const scope = {
      companyId: ctx.companyId,
      targetUid: outcome.user_uid,
      userUid: outcome.user_uid,
      departmentId: target.data?.department_id,
      departmentIds: targetDepartmentIds,
      department: target.data?.department,
    };
    const canCorrect = ctx.requester.role === 'super_admin'
      || await hasPermission(supabase, ctx.requester, 'manual_attendance', scope)
      || await hasPermission(supabase, ctx.requester, 'edit_leave_balance', scope);
    if (!canCorrect) return res.status(403).json({ success: false, error: 'Permission required: manual_attendance or edit_leave_balance' });
    const data = await reconcileAbsenceOutcome({
      companyId: ctx.companyId,
      summaryId: outcome.summary_id,
      reason: String(req.body?.reason || 'MANUAL_RECONCILIATION').slice(0, 200),
      actorUid: ctx.requester.uid,
    });
    const { data: ledgerRows } = await supabase
      .from('leave_balance_adjustments')
      .select('id, transaction_type, amount, reversal_of_id')
      .eq('company_id', ctx.companyId)
      .eq('outcome_id', outcome.id)
      .order('created_at', { ascending: true });
    await writeAuthorizationAudit(supabase, {
      companyId: ctx.companyId,
      actorUid: ctx.requester.uid,
      targetUid: outcome.user_uid,
      action: 'attendance_absence_outcome_reconciled',
      beforeState: outcome,
      afterState: data,
      metadata: {
        summary_id: outcome.summary_id,
        outcome_id: outcome.id,
        work_date: outcome.work_date,
        reason: String(req.body?.reason || 'MANUAL_RECONCILIATION').slice(0, 200),
        ledger: ledgerRows || [],
      },
    });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to reconcile absence outcome' });
  }
});

module.exports = router;
