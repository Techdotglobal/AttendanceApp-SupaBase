const { supabase } = require('../config/supabase');
const {
  dateOnly,
  addDays,
  localParts,
  resolveEffectiveRule,
  resolveScheduleWindow,
  calculateDailySummary,
} = require('../../../shared/attendance/attendanceRules.cjs');
const { processAbsenceOutcome } = require('./attendanceAbsenceService');

function featureEnabled(company) {
  return company?.app_settings?.attendance_rules_v1_enabled === true
    || company?.app_settings?.attendance?.rulesV1Enabled === true;
}

function ruleSnapshot(rule, window) {
  return {
    id: rule?.id || null,
    version: rule?.version || 1,
    scope_type: rule?.scope_type || 'COMPANY',
    timezone: window?.timezone || rule?.timezone || 'UTC',
    scheduled_start: rule?.scheduled_start || rule?.scheduledStart || null,
    scheduled_end: rule?.scheduled_end || rule?.scheduledEnd || null,
    grace_minutes: Number(rule?.grace_minutes ?? rule?.graceMinutes ?? 0),
    working_days: rule?.working_days || rule?.workingDays || [1, 2, 3, 4, 5],
    overtime_enabled: Boolean(rule?.overtime_enabled ?? rule?.overtimeEnabled),
    overtime_window_minutes: Number(rule?.overtime_window_minutes ?? rule?.overtimeWindowMinutes ?? 0),
    auto_checkout_enabled: rule?.auto_checkout_enabled !== false,
    effective_from: rule?.effective_from || null,
    effective_to: rule?.effective_to || null,
  };
}

function ruleFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.scheduled_start) return null;
  return {
    id: snapshot.id,
    version: snapshot.version,
    scope_type: snapshot.scope_type,
    timezone: snapshot.timezone,
    scheduled_start: snapshot.scheduled_start,
    scheduled_end: snapshot.scheduled_end,
    grace_minutes: snapshot.grace_minutes,
    working_days: snapshot.working_days,
    overtime_enabled: snapshot.overtime_enabled,
    overtime_window_minutes: snapshot.overtime_window_minutes,
    auto_checkout_enabled: snapshot.auto_checkout_enabled,
    effective_from: snapshot.effective_from,
    effective_to: snapshot.effective_to,
  };
}

function persistedScheduleWindow(summary, rule, workDate) {
  const fallback = resolveScheduleWindow(rule, workDate);
  if (!summary?.scheduled_start_at || !summary?.scheduled_end_at) return fallback;
  const start = new Date(summary.scheduled_start_at);
  const end = new Date(summary.scheduled_end_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fallback;
  const overtimeMinutes = Number(rule?.overtime_window_minutes ?? rule?.overtimeWindowMinutes ?? 0);
  return {
    ...fallback,
    timezone: summary.timezone || fallback.timezone,
    start,
    end,
    scheduledDurationSeconds: Number(summary.scheduled_duration_seconds ?? Math.max(0, Math.round((end - start) / 1000))),
    overtimeDeadline: new Date(end.getTime() + overtimeMinutes * 60 * 1000),
  };
}

function localDateAt(value, timezone) {
  const parts = localParts(value, timezone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function hasOpenSession(rows) {
  let open = false;
  for (const row of rows) {
    const type = String(row?.type || '').toLowerCase().replace(/_/g, '');
    if (type === 'checkin') open = true;
    else if (type === 'checkout' && open) open = false;
  }
  return open;
}

function selectEventsForWindow(rows, workDate, window) {
  const nextDate = addDays(workDate, 1);
  const valid = (rows || [])
    .filter((row) => row?.timestamp && !Number.isNaN(new Date(row.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.id || '').localeCompare(String(b.id || '')));
  const sameDay = valid.filter((row) => localDateAt(row.timestamp, window.timezone) === workDate);
  const endLocalDate = localDateAt(window.end, window.timezone);
  if (endLocalDate === workDate || !hasOpenSession(sameDay)) return sameDay;

  const nextDay = valid.filter((row) => localDateAt(row.timestamp, window.timezone) === nextDate);
  const result = [...sameDay];
  let open = true;
  for (const row of nextDay) {
    result.push(row);
    const type = String(row?.type || '').toLowerCase().replace(/_/g, '');
    if (type === 'checkout' && open) {
      open = false;
      break;
    }
  }
  return result;
}

async function loadCompany(companyId) {
  const { data, error } = await supabase.from('companies').select('id, name, app_settings').eq('id', companyId).single();
  if (error) throw error;
  return data;
}

async function loadRules(companyId) {
  const { data, error } = await supabase
    .from('attendance_schedule_rules')
    .select('*')
    .eq('company_id', companyId)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadUsers(companyId, userUid = null) {
  let query = supabase
    .from('users')
    .select('uid, username, name, department, department_id, company_id, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (userUid) query = query.eq('uid', userUid);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadPrimaryDepartments(companyId, users) {
  const uids = (users || []).map((user) => user.uid).filter(Boolean);
  if (!uids.length) return new Map();
  const { data, error } = await supabase
    .from('user_department_assignments')
    .select('user_uid, department_id, is_primary')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('user_uid', uids);
  if (error) return new Map(); // Phase 1 compatibility fallback
  const map = new Map();
  for (const row of data || []) {
    if (row.is_primary || !map.has(row.user_uid)) map.set(row.user_uid, row.department_id);
  }
  return map;
}

async function loadSummary(companyId, userUid, workDate) {
  const { data, error } = await supabase
    .from('attendance_daily_summaries')
    .select('*')
    .eq('company_id', companyId)
    .eq('user_uid', userUid)
    .eq('work_date', workDate)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadEvents(companyId, userUid, workDate, window) {
  // Legacy attendance rows can have a NULL company_id. They are historical
  // source data and must remain untouched, but they must never enter a
  // tenant-scoped Phase 3 calculation. The equality predicate intentionally
  // excludes those rows.
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('company_id', companyId)
    .eq('user_uid', userUid)
    .order('timestamp', { ascending: true });
  if (error) throw error;
  return selectEventsForWindow(data || [], workDate, window);
}

async function loadHoliday(companyId, workDate) {
  const { data, error } = await supabase
    .from('attendance_holidays')
    .select('*')
    .eq('company_id', companyId)
    .eq('holiday_date', workDate)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadLeave(companyId, userUid, workDate) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, employee_uid, start_date, end_date, status, is_half_day, half_day_period')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lte('start_date', workDate)
    .gte('end_date', workDate)
    .order('start_date', { ascending: true });
  if (error) throw error;
  // leave_requests.employee_uid is UUID in production while users.uid is
  // TEXT. Compare their canonical text representations after the tenant/date
  // filter instead of relying on a PostgREST UUID/TEXT comparison cast.
  return (data || []).find((row) => String(row.employee_uid) === String(userUid)) || null;
}

async function ensureContext(companyId, user, workDate, resolvedRule, mode, allowCreate = true) {
  const existing = await loadSummary(companyId, user.uid, workDate);
  if (existing) return existing;
  if (mode === 'observe' || !allowCreate) return null;
  const window = resolveScheduleWindow(resolvedRule, workDate);
  const snapshot = ruleSnapshot(resolvedRule, window);
  const payload = {
    company_id: companyId,
    user_uid: user.uid,
    work_date: workDate,
    schedule_rule_id: resolvedRule?.id || null,
    schedule_version: resolvedRule?.version || 1,
    timezone: window.timezone,
    scheduled_start_at: window.start.toISOString(),
    scheduled_end_at: window.end.toISOString(),
    scheduled_duration_seconds: window.scheduledDurationSeconds,
    calculation_snapshot: snapshot,
    status: 'OPEN',
  };
  const { data, error } = await supabase.from('attendance_daily_summaries').insert(payload).select('*').single();
  if (!error) return data;
  // Another worker may have won the first-context race. Re-read the persisted
  // snapshot instead of applying a newly changed schedule.
  const raced = await loadSummary(companyId, user.uid, workDate);
  if (raced) return raced;
  throw error;
}

async function createScheduledCheckout(checkin, scheduledEndAt) {
  const { data, error } = await supabase.rpc('create_scheduled_attendance_checkout', {
    p_company_id: checkin.company_id,
    p_checkin_id: checkin.id,
    p_scheduled_end_at: scheduledEndAt,
  });
  if (error) throw error;
  return data || null;
}

async function finalizeUserDay({ companyId, user, workDate, rules, mode = 'active', now = new Date(), company = null }) {
  const normalizedWorkDate = dateOnly(workDate);
  // Phase 1 keeps this projection synchronized with the active primary
  // assignment. Preserve the explicitly loaded assignment when it exists.
  const userWithDepartment = {
    ...user,
    primary_department_id: user.primary_department_id || user.department_id || null,
  };
  let summary = await loadSummary(companyId, user.uid, normalizedWorkDate);
  let rule;
  let window;

  if (summary) {
    rule = ruleFromSnapshot(summary.calculation_snapshot);
    if (!rule) throw new Error(`Attendance summary ${summary.id} is missing its immutable schedule snapshot`);
    window = persistedScheduleWindow(summary, rule, normalizedWorkDate);
  } else {
    rule = resolveEffectiveRule(rules, userWithDepartment, companyId, normalizedWorkDate);
    if (!rule) return { user_uid: user.uid, work_date: normalizedWorkDate, status: 'NO_SCHEDULE', absence_eligible: false };
    window = resolveScheduleWindow(rule, normalizedWorkDate);
  }

  const localToday = localDateAt(now, window.timezone);
  const historicalWithoutContext = !summary && normalizedWorkDate < localToday;
  const futureWithoutContext = !summary && normalizedWorkDate > localToday;

  if (mode === 'active' && summary && normalizedWorkDate < localToday
    && summary.needs_refinalization !== true && summary.status !== 'OPEN') {
    return summary;
  }

  if (mode === 'active' && !summary && !historicalWithoutContext && !futureWithoutContext) {
    // The insert is the first successful daily-context creation. If another
    // worker wins the unique-key race, ensureContext reloads its snapshot.
    summary = await ensureContext(companyId, user, normalizedWorkDate, rule, mode, true);
    if (summary) {
      rule = ruleFromSnapshot(summary.calculation_snapshot);
      if (!rule) throw new Error(`Attendance summary ${summary.id} is missing its immutable schedule snapshot`);
      window = persistedScheduleWindow(summary, rule, normalizedWorkDate);
    }
  }

  const holiday = await loadHoliday(companyId, normalizedWorkDate);
  const leave = await loadLeave(companyId, user.uid, normalizedWorkDate);
  let records = await loadEvents(companyId, user.uid, normalizedWorkDate, window);
  let calculated = calculateDailySummary({ rule, workDate: normalizedWorkDate, records, holiday, leave, now, scheduleWindow: window });

  // Do not create historical/future contexts implicitly. Existing summaries
  // may still be recalculated when dirty or left open for scheduled checkout.
  if (mode !== 'active' || !summary || historicalWithoutContext || futureWithoutContext) {
    return {
      ...calculated,
      user_uid: user.uid,
      observe_only: true,
      context_skipped: historicalWithoutContext ? 'historical_without_context' : futureWithoutContext ? 'future_local_date' : undefined,
    };
  }

  const oldSummary = summary;
  const openSession = calculated.open && calculated.checkin;
  if (openSession && rule.auto_checkout_enabled !== false && new Date(now) >= window.overtimeDeadline) {
    await createScheduledCheckout(calculated.checkin, window.end.toISOString());
    records = await loadEvents(companyId, user.uid, normalizedWorkDate, window);
    calculated = calculateDailySummary({ rule, workDate: normalizedWorkDate, records, holiday, leave, now, scheduleWindow: window });
  }

  const update = {
    // These snapshot/context fields are written with the persisted values only;
    // normal finalization never re-resolves or changes them.
    schedule_rule_id: oldSummary.schedule_rule_id || null,
    schedule_version: oldSummary.schedule_version ?? null,
    timezone: oldSummary.timezone,
    scheduled_start_at: oldSummary.scheduled_start_at,
    scheduled_end_at: oldSummary.scheduled_end_at,
    scheduled_duration_seconds: oldSummary.scheduled_duration_seconds,
    checkin_id: calculated.checkin?.id || null,
    checkout_id: calculated.checkout?.id || null,
    checkin_at: calculated.checkin?.timestamp || null,
    checkout_at: calculated.checkout?.timestamp || null,
    checkout_source: calculated.checkout_source,
    late_seconds: calculated.late_seconds,
    worked_seconds: calculated.worked_seconds,
    regular_seconds: calculated.regular_seconds,
    overtime_seconds: calculated.overtime_seconds,
    status: calculated.status,
    holiday_id: calculated.holiday_id,
    leave_request_id: calculated.leave_request_id,
    absence_eligible: calculated.absence_eligible,
    needs_refinalization: false,
    finalized_at: calculated.status === 'OPEN' ? null : new Date().toISOString(),
    absence_prepared_at: calculated.status === 'OPEN' ? null : new Date().toISOString(),
    calculation_snapshot: { ...(oldSummary.calculation_snapshot || {}), invalid_events: calculated.invalid_events },
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('attendance_daily_summaries').update(update).eq('id', oldSummary.id).select('*').single();
  if (error) throw error;
  if (company) await processAbsenceOutcome({ company, summary: data, mode });
  return data;
}

async function finalizeCompanyDay({ companyId, workDate, mode = 'active', now = new Date(), userUid = null }) {
  const company = await loadCompany(companyId);
  if (!featureEnabled(company)) return { enabled: false, company_id: companyId, work_date: workDate, results: [] };
  const users = await loadUsers(companyId, userUid);
  const primary = await loadPrimaryDepartments(companyId, users);
  const withDepartments = users.map((user) => ({ ...user, primary_department_id: primary.get(user.uid) || user.department_id || null }));
  const rules = await loadRules(companyId);
  const results = [];
  for (const user of withDepartments) {
    results.push(await finalizeUserDay({ companyId, user, workDate: dateOnly(workDate), rules, mode, now, company }));
  }
  return { enabled: true, company_id: companyId, work_date: dateOnly(workDate), mode, results };
}

async function markAttendanceSummaryDirty(companyId, userUid, timestamp, relatedTimestamp = null) {
  if (!companyId || !userUid || !timestamp) return;
  const days = [dateOnly(timestamp)];
  if (relatedTimestamp) days.push(dateOnly(relatedTimestamp));
  days.sort();
  const from = addDays(days[0], -1);
  const to = addDays(days[days.length - 1], 1);
  const { error } = await supabase
    .from('attendance_daily_summaries')
    .update({ needs_refinalization: true, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('user_uid', userUid)
    .gte('work_date', from)
    .lte('work_date', to);
  if (error) {
    // Keep legacy manual correction behavior intact if the additive migration
    // has not been deployed alongside the service yet.
    console.warn('[attendance-finalizer] unable to mark summary dirty:', error.message);
    return false;
  }
  return true;
}

module.exports = {
  featureEnabled,
  ruleSnapshot,
  ruleFromSnapshot,
  persistedScheduleWindow,
  selectEventsForWindow,
  localDateAt,
  ensureContext,
  finalizeUserDay,
  finalizeCompanyDay,
  markAttendanceSummaryDirty,
};
