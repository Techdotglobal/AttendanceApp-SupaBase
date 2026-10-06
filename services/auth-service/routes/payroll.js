/**
 * Payroll V1 admin routes — super_admin only (spec: managers get no payroll
 * access merely by managing attendance/leave; employees have no payroll UI
 * in V1). Mounted at /api/admin/payroll from routes/admin.js.
 *
 * Follows the same request-handling shape as the rest of routes/admin.js:
 * resolveRequester -> tenant company_id -> role check -> service-role
 * Supabase query -> payroll_audit_logs entry for every mutation.
 */
const express = require('express');
const { supabase } = require('../config/supabase');
const { resolveRequester } = require('../lib/resolveRequester');
const { getTenantCompanyId } = require('../lib/tenantScope');
const { getEffectiveGrants } = require('../lib/permissions');
const {
  findProfileForDate,
  calculatePayrollRecord,
  DEFAULT_PAID_LEAVE_TYPES,
} = require('../lib/payrollEngine');

const router = express.Router();

const PERIOD_STATUSES = ['draft', 'calculated', 'reviewed', 'approved', 'locked'];
const EARNING_TYPES = ['basic_salary', 'allowance', 'bonus', 'overtime', 'other'];
const DEDUCTION_TYPES = ['tax', 'absence', 'loan', 'advance', 'other'];

async function withPayrollContext(req, res) {
  const requester = await resolveRequester(req);
  if (!requester || !requester.uid || !requester.role) {
    res.status(401).json({ success: false, error: 'Authentication required. Sign in again.' });
    return null;
  }
  const companyId = await getTenantCompanyId(supabase, requester);
  if (!companyId) {
    res.status(403).json({ success: false, error: 'Missing tenant scope (company_id). Re-login or update the client.' });
    return null;
  }
  if (requester.role !== 'super_admin') {
    const requiredKey = req.method === 'GET' ? 'view_payroll' : 'manage_payroll';
    const grants = await getEffectiveGrants(supabase, { ...requester, company_id: companyId });
    const allowed = grants.some((grant) => grant.permission_key === requiredKey && grant.scope_type === 'COMPANY');
    if (!allowed) {
      res.status(403).json({ success: false, error: `Permission required: ${requiredKey}` });
      return null;
    }
  }
  return { requester, companyId };
}

async function writePayrollAudit(companyId, actorUid, action, entity, entityId, metadata = {}) {
  const { error } = await supabase.from('payroll_audit_logs').insert({
    company_id: companyId,
    actor_uid: actorUid,
    action,
    entity,
    entity_id: entityId,
    metadata,
  });
  if (error) console.warn('[payroll_audit_logs] write failed:', error.message);
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, error: message });
}

// ============================================
// Employee salary profiles
// ============================================

router.get('/salary-profiles', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const { employee_uid: employeeUid } = req.query;
    let query = supabase
      .from('employee_payroll_profiles')
      .select('*')
      .eq('company_id', companyId)
      .order('effective_from', { ascending: false });
    if (employeeUid) query = query.eq('employee_uid', employeeUid);
    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch salary profiles' });
  }
});

router.post('/salary-profiles', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const {
      employee_uid: employeeUid,
      salary_type: salaryType = 'monthly',
      basic_salary: basicSalary,
      currency = 'PKR',
      overtime_enabled: overtimeEnabled = false,
      overtime_rate: overtimeRate = null,
      standard_working_days: standardWorkingDays = 22,
      standard_working_hours: standardWorkingHours = 8,
      tax_enabled: taxEnabled = false,
      tax_type: taxType = null,
      tax_value: taxValue = null,
      effective_from: effectiveFrom,
      effective_to: effectiveTo = null,
    } = req.body || {};

    if (!employeeUid) return badRequest(res, 'employee_uid is required');
    if (!effectiveFrom) return badRequest(res, 'effective_from is required');
    if (!['monthly', 'hourly'].includes(salaryType)) return badRequest(res, 'salary_type must be monthly or hourly');
    if (basicSalary == null || Number(basicSalary) <= 0) return badRequest(res, 'basic_salary must be greater than 0');
    if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
      return badRequest(res, 'effective_to must be after effective_from');
    }
    if (overtimeEnabled && !(Number(overtimeRate) >= 0)) {
      return badRequest(res, 'overtime_rate is required when overtime is enabled');
    }
    if (taxEnabled && (!['fixed', 'percentage'].includes(taxType) || !(Number(taxValue) >= 0))) {
      return badRequest(res, 'tax_type and tax_value are required when tax is enabled');
    }

    const { data: employee, error: employeeError } = await supabase
      .from('users')
      .select('uid, company_id')
      .eq('uid', employeeUid)
      .eq('company_id', companyId)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found in this company' });

    const { data, error } = await supabase
      .from('employee_payroll_profiles')
      .insert({
        employee_uid: employeeUid,
        company_id: companyId,
        salary_type: salaryType,
        basic_salary: basicSalary,
        currency,
        overtime_enabled: overtimeEnabled,
        overtime_rate: overtimeEnabled ? overtimeRate : null,
        standard_working_days: standardWorkingDays,
        standard_working_hours: standardWorkingHours,
        tax_enabled: taxEnabled,
        tax_type: taxEnabled ? taxType : null,
        tax_value: taxEnabled ? taxValue : null,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        created_by: requester.uid,
        updated_by: requester.uid,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23P01') {
        return badRequest(res, 'This salary period overlaps an existing salary profile for this employee.');
      }
      throw error;
    }

    await writePayrollAudit(companyId, requester.uid, 'salary_profile_created', 'employee_payroll_profiles', data.id, {
      employee_uid: employeeUid,
      basic_salary: basicSalary,
      effective_from: effectiveFrom,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create salary profile' });
  }
});

router.patch('/salary-profiles/:id', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { id } = req.params;
    const { data: existing, error: existingError } = await supabase
      .from('employee_payroll_profiles')
      .select('id, effective_from')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, error: 'Salary profile not found' });

    // Historical salary records are never overwritten in place — only the
    // open-ended end date of a profile may be edited (e.g. to close it early).
    const { effective_to: effectiveTo } = req.body || {};
    if (effectiveTo && new Date(effectiveTo) <= new Date(existing.effective_from)) {
      return badRequest(res, 'effective_to must be after effective_from');
    }
    const { data, error } = await supabase
      .from('employee_payroll_profiles')
      .update({ effective_to: effectiveTo ?? null, updated_by: requester.uid, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) {
      if (error.code === '23P01') return badRequest(res, 'This change would overlap another salary profile.');
      throw error;
    }
    await writePayrollAudit(companyId, requester.uid, 'salary_profile_changed', 'employee_payroll_profiles', id, req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update salary profile' });
  }
});

// ============================================
// Payroll periods
// ============================================

router.get('/periods', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('*')
      .eq('company_id', companyId)
      .order('period_start', { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch payroll periods' });
  }
});

router.get('/periods/:id', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Payroll period not found' });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch payroll period' });
  }
});

router.post('/periods', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { period_start: periodStart, period_end: periodEnd, pay_date: payDate = null, notes = null } = req.body || {};
    if (!periodStart || !periodEnd) return badRequest(res, 'period_start and period_end are required');
    if (new Date(periodStart) >= new Date(periodEnd)) return badRequest(res, 'period_start must be before period_end');

    const { data, error } = await supabase
      .from('payroll_periods')
      .insert({
        company_id: companyId,
        period_start: periodStart,
        period_end: periodEnd,
        pay_date: payDate,
        notes,
        status: 'draft',
        created_by: requester.uid,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23P01') return badRequest(res, 'This date range overlaps an existing payroll period.');
      throw error;
    }
    await writePayrollAudit(companyId, requester.uid, 'payroll_period_created', 'payroll_periods', data.id, {
      period_start: periodStart,
      period_end: periodEnd,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create payroll period' });
  }
});

async function loadPeriodOr404(companyId, periodId, res) {
  const { data, error } = await supabase
    .from('payroll_periods')
    .select('*')
    .eq('id', periodId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    res.status(404).json({ success: false, error: 'Payroll period not found' });
    return null;
  }
  return data;
}

/**
 * Calculate (or recalculate) every employee's payroll for a draft/calculated
 * period. Employees missing an effective salary profile are skipped and
 * reported back rather than silently producing an incorrect payroll
 * (spec §24) — the admin fixes the profile and calls this again.
 */
async function runCalculation({ companyId, requester, period }) {
  const { data: employees, error: employeesError } = await supabase
    .from('users')
    .select('uid, name, username, department_id, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (employeesError) throw employeesError;

  const { data: allProfiles, error: profilesError } = await supabase
    .from('employee_payroll_profiles')
    .select('*')
    .eq('company_id', companyId);
  if (profilesError) throw profilesError;

  const profilesByEmployee = new Map();
  for (const profile of allProfiles || []) {
    const list = profilesByEmployee.get(profile.employee_uid) || [];
    list.push(profile);
    profilesByEmployee.set(profile.employee_uid, list);
  }

  const { data: attendanceRows, error: attendanceError } = await supabase
    .from('attendance_records')
    .select('user_uid, type, timestamp')
    .eq('company_id', companyId)
    .gte('timestamp', `${period.period_start}T00:00:00Z`)
    .lte('timestamp', `${period.period_end}T23:59:59Z`);
  if (attendanceError) throw attendanceError;

  const { data: leaveRows, error: leaveError } = await supabase
    .from('leave_requests')
    .select('employee_uid, leave_type, start_date, end_date, is_half_day, status')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lte('start_date', period.period_end)
    .gte('end_date', period.period_start);
  if (leaveError) throw leaveError;

  const attendanceByEmployee = new Map();
  for (const row of attendanceRows || []) {
    const list = attendanceByEmployee.get(row.user_uid) || [];
    list.push(row);
    attendanceByEmployee.set(row.user_uid, list);
  }
  const leaveByEmployee = new Map();
  for (const row of leaveRows || []) {
    const list = leaveByEmployee.get(row.employee_uid) || [];
    list.push(row);
    leaveByEmployee.set(row.employee_uid, list);
  }

  const missingProfiles = [];
  const results = [];

  for (const employee of employees || []) {
    const profiles = profilesByEmployee.get(employee.uid) || [];
    const profile = findProfileForDate(profiles, period.period_start);
    if (!profile) {
      missingProfiles.push({ uid: employee.uid, name: employee.name || employee.username });
      continue;
    }
    const calc = calculatePayrollRecord({
      profile,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      attendanceRecords: attendanceByEmployee.get(employee.uid) || [],
      leaveRequests: leaveByEmployee.get(employee.uid) || [],
      paidLeaveTypes: DEFAULT_PAID_LEAVE_TYPES,
    });
    results.push({ employee, profile, calc });
  }

  if (missingProfiles.length > 0) {
    return { ok: false, missingProfiles };
  }

  // Persist atomically-ish: delete any prior (non-locked) records for this
  // period then insert fresh ones + their basic/overtime earning lines.
  // payroll_records has ON DELETE CASCADE to earnings/deductions.
  const { error: deleteError } = await supabase.from('payroll_records').delete().eq('payroll_period_id', period.id);
  if (deleteError) throw deleteError;

  const recordRows = results.map(({ employee, profile, calc }) => ({
    payroll_period_id: period.id,
    employee_uid: employee.uid,
    company_id: companyId,
    department_id: employee.department_id || null,
    payroll_profile_id: profile.id,
    basic_salary: profile.basic_salary,
    salary_type: profile.salary_type,
    currency: profile.currency,
    working_days: calc.workingDays,
    worked_days: calc.workedDays,
    absent_days: calc.absentDays,
    paid_leave_days: calc.paidLeaveDays,
    unpaid_leave_days: calc.unpaidLeaveDays,
    regular_hours: calc.regularHours,
    overtime_hours: calc.overtimeHours,
    overtime_amount: calc.overtimeAmount,
    allowances_amount: calc.allowancesAmount,
    bonus_amount: calc.bonusAmount,
    gross_salary: calc.grossSalary,
    deductions_amount: calc.deductionsAmount,
    tax_amount: calc.taxAmount,
    net_salary: calc.netSalary,
    calculation_snapshot: calc.snapshot,
    status: 'calculated',
  }));

  if (recordRows.length === 0) {
    return { ok: true, count: 0 };
  }

  const { data: insertedRecords, error: insertError } = await supabase
    .from('payroll_records')
    .insert(recordRows)
    .select('id, basic_salary');
  if (insertError) throw insertError;

  const earningsRows = [];
  const deductionRows = [];
  insertedRecords.forEach((record, index) => {
    const { calc } = results[index];
    earningsRows.push({
      payroll_record_id: record.id,
      company_id: companyId,
      type: 'basic_salary',
      name: 'Base earning',
      amount: calc.baseEarning,
    });
    if (calc.overtimeAmount > 0) {
      earningsRows.push({
        payroll_record_id: record.id,
        company_id: companyId,
        type: 'overtime',
        name: 'Overtime',
        amount: calc.overtimeAmount,
      });
    }
    if (calc.taxAmount > 0) {
      deductionRows.push({
        payroll_record_id: record.id,
        company_id: companyId,
        type: 'tax',
        name: 'Tax',
        amount: calc.taxAmount,
      });
    }
  });

  if (earningsRows.length > 0) {
    const { error } = await supabase.from('payroll_earnings').insert(earningsRows);
    if (error) throw error;
  }
  if (deductionRows.length > 0) {
    const { error } = await supabase.from('payroll_deductions').insert(deductionRows);
    if (error) throw error;
  }

  const { error: periodError } = await supabase
    .from('payroll_periods')
    .update({
      status: 'calculated',
      calculated_at: new Date().toISOString(),
      calculated_by: requester.uid,
      updated_at: new Date().toISOString(),
    })
    .eq('id', period.id);
  if (periodError) throw periodError;

  await writePayrollAudit(companyId, requester.uid, 'payroll_calculated', 'payroll_periods', period.id, {
    employees_calculated: recordRows.length,
  });

  return { ok: true, count: recordRows.length };
}

router.post('/periods/:id/calculate', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const period = await loadPeriodOr404(companyId, req.params.id, res);
    if (!period) return;
    if (period.status === 'locked') return badRequest(res, 'This payroll period is locked and cannot be recalculated.');
    if (!['draft', 'calculated'].includes(period.status)) {
      return badRequest(res, `Cannot calculate a period in "${period.status}" status.`);
    }
    const result = await runCalculation({ companyId, requester, period });
    if (!result.ok) {
      return res.status(422).json({
        success: false,
        error: 'Some employees are missing an effective salary profile for this period.',
        data: { missing_salary_profiles: result.missingProfiles },
      });
    }
    res.status(200).json({ success: true, data: { employees_calculated: result.count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to calculate payroll' });
  }
});

router.post('/periods/:id/recalculate', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const period = await loadPeriodOr404(companyId, req.params.id, res);
    if (!period) return;
    if (period.status === 'locked') return badRequest(res, 'This payroll period is locked and cannot be recalculated.');
    const result = await runCalculation({ companyId, requester, period });
    if (!result.ok) {
      return res.status(422).json({
        success: false,
        error: 'Some employees are missing an effective salary profile for this period.',
        data: { missing_salary_profiles: result.missingProfiles },
      });
    }
    await writePayrollAudit(companyId, requester.uid, 'payroll_recalculated', 'payroll_periods', period.id, {
      employees_calculated: result.count,
    });
    res.status(200).json({ success: true, data: { employees_calculated: result.count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to recalculate payroll' });
  }
});

async function transitionPeriod(req, res, { from, to, timestampField, actorField, action }) {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const period = await loadPeriodOr404(companyId, req.params.id, res);
    if (!period) return;
    if (!from.includes(period.status)) {
      return badRequest(res, `Cannot move a period from "${period.status}" to "${to}".`);
    }
    const updates = {
      status: to,
      updated_at: new Date().toISOString(),
      [timestampField]: new Date().toISOString(),
      [actorField]: requester.uid,
    };
    const { data, error } = await supabase.from('payroll_periods').update(updates).eq('id', period.id).select().single();
    if (error) throw error;
    if (to === 'locked') {
      await supabase.from('payroll_records').update({ status: 'locked' }).eq('payroll_period_id', period.id);
    } else if (to === 'approved') {
      await supabase.from('payroll_records').update({ status: 'approved' }).eq('payroll_period_id', period.id);
    } else if (to === 'reviewed') {
      await supabase.from('payroll_records').update({ status: 'reviewed' }).eq('payroll_period_id', period.id);
    }
    await writePayrollAudit(companyId, requester.uid, action, 'payroll_periods', period.id, { from: period.status, to });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || `Failed to move payroll period to ${to}` });
  }
}

router.post('/periods/:id/review', (req, res) =>
  transitionPeriod(req, res, {
    from: ['calculated'],
    to: 'reviewed',
    timestampField: 'reviewed_at',
    actorField: 'reviewed_by',
    action: 'payroll_reviewed',
  })
);

router.post('/periods/:id/approve', (req, res) =>
  transitionPeriod(req, res, {
    from: ['reviewed'],
    to: 'approved',
    timestampField: 'approved_at',
    actorField: 'approved_by',
    action: 'payroll_approved',
  })
);

router.post('/periods/:id/lock', (req, res) =>
  transitionPeriod(req, res, {
    from: ['approved'],
    to: 'locked',
    timestampField: 'locked_at',
    actorField: 'locked_by',
    action: 'payroll_locked',
  })
);

// ============================================
// Payroll records (review table + employee detail)
// ============================================

router.get('/periods/:id/records', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const period = await loadPeriodOr404(companyId, req.params.id, res);
    if (!period) return;
    const { department_id: departmentId, status, search } = req.query;

    // employee_uid has no FK to users (see migration notes — mirrors the
    // existing attendance_records/leave_requests convention), so employee
    // and department names are joined manually below rather than embedded.
    let query = supabase.from('payroll_records').select('*').eq('payroll_period_id', period.id).eq('company_id', companyId);
    if (departmentId) query = query.eq('department_id', departmentId);
    if (status) query = query.eq('status', status);

    const { data: records, error } = await query;
    if (error) throw error;

    const employeeUids = [...new Set((records || []).map((r) => r.employee_uid))];
    const [{ data: users }, { data: departments }] = await Promise.all([
      employeeUids.length
        ? supabase.from('users').select('uid, name, username, department_id').in('uid', employeeUids)
        : { data: [] },
      supabase.from('departments').select('id, name').eq('company_id', companyId),
    ]);
    const usersByUid = new Map((users || []).map((u) => [u.uid, u]));
    const departmentsById = new Map((departments || []).map((d) => [d.id, d]));

    let enriched = (records || []).map((record) => {
      const user = usersByUid.get(record.employee_uid);
      const department = departmentsById.get(record.department_id);
      return {
        ...record,
        employee_name: user?.name || user?.username || 'Unknown employee',
        employee_username: user?.username || null,
        department_name: department?.name || null,
      };
    });

    if (search) {
      const term = String(search).toLowerCase();
      enriched = enriched.filter((r) => `${r.employee_name} ${r.employee_username || ''}`.toLowerCase().includes(term));
    }

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch payroll records' });
  }
});

router.get('/records/:id', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const { data: record, error } = await supabase
      .from('payroll_records')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    if (!record) return res.status(404).json({ success: false, error: 'Payroll record not found' });

    const [{ data: user }, { data: department }, { data: earnings }, { data: deductions }] = await Promise.all([
      supabase.from('users').select('uid, name, username, position').eq('uid', record.employee_uid).maybeSingle(),
      record.department_id
        ? supabase.from('departments').select('id, name').eq('id', record.department_id).maybeSingle()
        : { data: null },
      supabase.from('payroll_earnings').select('*').eq('payroll_record_id', record.id).order('created_at'),
      supabase.from('payroll_deductions').select('*').eq('payroll_record_id', record.id).order('created_at'),
    ]);

    res.status(200).json({
      success: true,
      data: {
        ...record,
        employee_name: user?.name || user?.username || 'Unknown employee',
        employee_username: user?.username || null,
        employee_position: user?.position || null,
        department_name: department?.name || null,
        earnings: earnings || [],
        deductions: deductions || [],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch payroll record' });
  }
});

async function recalculateRecordTotals(recordId) {
  const [{ data: record }, { data: earnings }, { data: deductions }] = await Promise.all([
    supabase.from('payroll_records').select('*').eq('id', recordId).single(),
    supabase.from('payroll_earnings').select('amount').eq('payroll_record_id', recordId),
    supabase.from('payroll_deductions').select('type, amount').eq('payroll_record_id', recordId),
  ]);
  const grossSalary = (earnings || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const taxAmount = (deductions || []).filter((d) => d.type === 'tax').reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const deductionsAmount = (deductions || [])
    .filter((d) => d.type !== 'tax')
    .reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const netSalary = grossSalary - deductionsAmount - taxAmount;
  const { error } = await supabase
    .from('payroll_records')
    .update({
      gross_salary: Math.round(grossSalary * 100) / 100,
      deductions_amount: Math.round(deductionsAmount * 100) / 100,
      tax_amount: Math.round(taxAmount * 100) / 100,
      net_salary: Math.round(netSalary * 100) / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', recordId);
  if (error) throw error;
  return record;
}

// ============================================
// Manual adjustments — earnings/deductions rows with is_manual = true.
// Blocked once the parent period is locked (spec §29).
// ============================================

router.post('/records/:id/adjustments', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { id } = req.params;
    const { kind, type, amount, reason } = req.body || {};
    if (!['earning', 'deduction'].includes(kind)) return badRequest(res, 'kind must be earning or deduction');
    const allowedTypes = kind === 'earning' ? EARNING_TYPES : DEDUCTION_TYPES;
    if (!allowedTypes.includes(type)) return badRequest(res, `type must be one of: ${allowedTypes.join(', ')}`);
    if (!(Number(amount) > 0)) return badRequest(res, 'amount must be greater than 0');
    if (!reason || !String(reason).trim()) return badRequest(res, 'reason is required for a manual adjustment');

    const { data: record, error: recordError } = await supabase
      .from('payroll_records')
      .select('id, status, company_id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (recordError) throw recordError;
    if (!record) return res.status(404).json({ success: false, error: 'Payroll record not found' });
    if (record.status === 'locked') return badRequest(res, 'This payroll record is locked and cannot be adjusted.');

    const table = kind === 'earning' ? 'payroll_earnings' : 'payroll_deductions';
    const { data, error } = await supabase
      .from(table)
      .insert({
        payroll_record_id: id,
        company_id: companyId,
        type,
        name: req.body.name || type,
        amount,
        description: reason,
        is_manual: true,
        created_by: requester.uid,
      })
      .select()
      .single();
    if (error) throw error;

    await recalculateRecordTotals(id);
    await writePayrollAudit(companyId, requester.uid, 'manual_adjustment_created', table, data.id, {
      payroll_record_id: id,
      type,
      amount,
      reason,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to add adjustment' });
  }
});

router.delete('/adjustments/:kind/:id', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { kind, id } = req.params;
    if (!['earning', 'deduction'].includes(kind)) return badRequest(res, 'kind must be earning or deduction');
    const table = kind === 'earning' ? 'payroll_earnings' : 'payroll_deductions';

    const { data: row, error: rowError } = await supabase
      .from(table)
      .select('id, payroll_record_id, is_manual, company_id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return res.status(404).json({ success: false, error: 'Adjustment not found' });
    if (!row.is_manual) return badRequest(res, 'Only manual adjustments can be removed.');

    const { data: record } = await supabase
      .from('payroll_records')
      .select('status')
      .eq('id', row.payroll_record_id)
      .single();
    if (record?.status === 'locked') return badRequest(res, 'This payroll record is locked and cannot be adjusted.');

    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    await recalculateRecordTotals(row.payroll_record_id);
    await writePayrollAudit(companyId, requester.uid, 'manual_adjustment_deleted', table, id, {
      payroll_record_id: row.payroll_record_id,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to remove adjustment' });
  }
});

// ============================================
// Reports
// ============================================

router.get('/reports/summary/:periodId', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const period = await loadPeriodOr404(companyId, req.params.periodId, res);
    if (!period) return;
    const { data: records, error } = await supabase
      .from('payroll_records')
      .select('gross_salary, deductions_amount, tax_amount, net_salary, department_id')
      .eq('payroll_period_id', period.id)
      .eq('company_id', companyId);
    if (error) throw error;

    const summary = (records || []).reduce(
      (acc, r) => {
        acc.employees += 1;
        acc.gross += Number(r.gross_salary || 0);
        acc.deductions += Number(r.deductions_amount || 0);
        acc.tax += Number(r.tax_amount || 0);
        acc.net += Number(r.net_salary || 0);
        return acc;
      },
      { employees: 0, gross: 0, deductions: 0, tax: 0, net: 0 }
    );

    const { data: departments } = await supabase.from('departments').select('id, name').eq('company_id', companyId);
    const departmentsById = new Map((departments || []).map((d) => [d.id, d.name]));
    const byDepartment = new Map();
    for (const r of records || []) {
      const key = r.department_id || 'unassigned';
      if (!byDepartment.has(key)) {
        byDepartment.set(key, { department_id: r.department_id, department_name: departmentsById.get(r.department_id) || 'Unassigned', employees: 0, gross: 0, deductions: 0, net: 0 });
      }
      const bucket = byDepartment.get(key);
      bucket.employees += 1;
      bucket.gross += Number(r.gross_salary || 0);
      bucket.deductions += Number(r.deductions_amount || 0) + Number(r.tax_amount || 0);
      bucket.net += Number(r.net_salary || 0);
    }

    res.status(200).json({
      success: true,
      data: { period, summary, departments: Array.from(byDepartment.values()) },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to build payroll report' });
  }
});

// ============================================
// Dashboard
// ============================================

router.get('/dashboard', async (req, res) => {
  const ctx = await withPayrollContext(req, res);
  if (!ctx) return;
  const { companyId } = ctx;
  try {
    const { data: periods, error } = await supabase
      .from('payroll_periods')
      .select('*')
      .eq('company_id', companyId)
      .order('period_start', { ascending: false })
      .limit(12);
    if (error) throw error;

    const periodIds = (periods || []).map((p) => p.id);
    let recordCounts = new Map();
    let totals = new Map();
    if (periodIds.length > 0) {
      const { data: records } = await supabase
        .from('payroll_records')
        .select('payroll_period_id, net_salary, gross_salary, status')
        .in('payroll_period_id', periodIds);
      for (const record of records || []) {
        recordCounts.set(record.payroll_period_id, (recordCounts.get(record.payroll_period_id) || 0) + 1);
        const t = totals.get(record.payroll_period_id) || { gross: 0, net: 0 };
        t.gross += Number(record.gross_salary || 0);
        t.net += Number(record.net_salary || 0);
        totals.set(record.payroll_period_id, t);
      }
    }

    const enrichedPeriods = (periods || []).map((p) => ({
      ...p,
      employee_count: recordCounts.get(p.id) || 0,
      gross_total: totals.get(p.id)?.gross || 0,
      net_total: totals.get(p.id)?.net || 0,
    }));

    const current = enrichedPeriods.find((p) => p.status !== 'locked') || enrichedPeriods[0] || null;
    const kpis = {
      current_period: current,
      total_payroll: current?.net_total || 0,
      employees_included: current?.employee_count || 0,
      pending_review: enrichedPeriods.filter((p) => p.status === 'calculated').length,
      approved: enrichedPeriods.filter((p) => p.status === 'approved').length,
      locked: enrichedPeriods.filter((p) => p.status === 'locked').length,
    };

    res.status(200).json({ success: true, data: { kpis, periods: enrichedPeriods } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to load payroll dashboard' });
  }
});

module.exports = router;
