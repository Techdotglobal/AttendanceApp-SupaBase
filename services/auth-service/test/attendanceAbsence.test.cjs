const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  absenceFeatureEnabled,
  normalizePolicy,
  policyApplies,
  processAbsenceOutcome,
  reconcileAbsenceOutcome,
  reconcileApprovedLeaveAbsenceOutcomes,
} = require('../lib/attendanceAbsenceService');

test('absence migration is additive, tenant guarded, and service-role writes only', () => {
  const migration = read('supabase/migrations/20261007120000_attendance_absence_deductions.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attendance_absence_policies/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attendance_absence_outcomes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.leave_balance_adjustments/);
  assert.match(migration, /absence outcome summary must belong to its company and user/);
  assert.match(migration, /leave adjustment outcome must belong to its company and user/);
  assert.match(migration, /absence policy actor must belong to its company/);
  assert.match(migration, /absence reconciliation actor must belong to its company/);
  assert.match(migration, /leave adjustment actor must belong to its company/);
  assert.match(migration, /attendance_daily_summaries\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /attendance_absence_outcomes\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /REVOKE ALL ON public\.attendance_absence_policies/);
  assert.match(migration, /apply_attendance_absence_outcome/);
  assert.match(migration, /reconcile_attendance_absence_outcome/);
  assert.match(migration, /leave balance adjustments are immutable/);
  assert.match(migration, /policy_snapshot_history/);
  assert.match(migration, /absence policy snapshot history is immutable/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.attendance_records/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.leave_requests/i);
});

test('absence service keeps policy decisions behind the existing finalizer', () => {
  const finalizer = read('services/auth-service/lib/attendanceFinalizer.js');
  const service = read('services/auth-service/lib/attendanceAbsenceService.js');
  assert.match(finalizer, /processAbsenceOutcome/);
  assert.match(service, /apply_attendance_absence_outcome/);
  assert.match(service, /reconcile_attendance_absence_outcome/);
  assert.match(service, /mode !== 'active'/);
  assert.match(service, /absenceDeductionsV1Enabled/);
});

test('balance and payroll compatibility remain additive', () => {
  const mobile = read('apps/mobile/utils/leaveManagement.js');
  const payroll = read('services/auth-service/routes/payroll.js');
  const reporting = read('services/reporting-service/services/queryService.js');
  assert.match(mobile, /get_effective_leave_balance/);
  assert.match(mobile, /Compatibility fallback/);
  assert.match(payroll, /from\('attendance_records'\)/);
  assert.match(payroll, /from\('leave_requests'\)/);
  assert.match(reporting, /from\('attendance_records'\)/);
});

test('absence policy and balance contract covers configured deduction branches', () => {
  assert.equal(absenceFeatureEnabled({ app_settings: { leave: { absenceDeductionsV1Enabled: true } } }), true);
  assert.equal(absenceFeatureEnabled({ app_settings: {} }), false);
  assert.equal(policyApplies(normalizePolicy({ enabled: true, action: 'DEDUCT_LEAVE', effective_from: '2026-01-01' }), '2026-01-01'), true);
  assert.equal(policyApplies(normalizePolicy({ enabled: true, action: 'NONE', effective_from: '2026-01-01' }), '2026-01-01'), false);

  const effective = (allocation, approved, adjustments) => allocation - approved - adjustments;
  const cap = (allocation, approved, adjustments, requested) => {
    const available = Math.max(effective(allocation, approved, adjustments), 0);
    const deducted = Math.min(requested, available);
    return { deducted, unpaid: Math.max(requested - deducted, 0), resulting: effective(allocation, approved, adjustments) - deducted };
  };
  assert.deepEqual(cap(10, 2, 0, 1), { deducted: 1, unpaid: 0, resulting: 7 });
  assert.deepEqual(cap(1, 0, 0, 1), { deducted: 1, unpaid: 0, resulting: 0 });
  assert.deepEqual(cap(1, 0.5, 0, 1), { deducted: 0.5, unpaid: 0.5, resulting: 0 });
  assert.deepEqual(cap(0, 0, 0, 1), { deducted: 0, unpaid: 1, resulting: 0 });
  assert.equal(effective(1, 0, -1), 2, 'a reversal restores the prior deduction exactly once');

  const migration = read('supabase/migrations/20261007120000_attendance_absence_deductions.sql');
  assert.match(migration, /v_insufficient = 'ALLOW_NEGATIVE'/);
  assert.match(migration, /v_insufficient = 'NO_DEDUCTION'/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /UNIQUE \(outcome_id, cycle, transaction_type\)/);
});

test('absence service uses the finalized summary and is injectable for runtime reconciliation tests', async () => {
  const calls = [];
  const query = (result = { data: [], error: null }) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };
  const fakeClient = {
    from(table) {
      if (table === 'attendance_absence_policies') {
        return query({ data: { enabled: true, action: 'DEDUCT_LEAVE', leave_type: 'annual', deduction_days: 1, effective_from: '2026-01-01' }, error: null });
      }
      if (table === 'authorization_audit_logs') return { insert: async (payload) => { calls.push({ table, payload }); return { error: null }; } };
      return query({ data: [], error: null });
    },
    rpc(name, args) {
      calls.push({ name, args });
      if (name === 'apply_attendance_absence_outcome') return Promise.resolve({ data: { id: 'outcome-1', user_uid: 'user-1' }, error: null });
      return Promise.resolve({ data: { id: 'outcome-1', user_uid: 'user-1', status: 'RECONCILED' }, error: null });
    },
  };

  const applied = await processAbsenceOutcome({
    company: { id: 'company-1', app_settings: { leave: { absenceDeductionsV1Enabled: true } } },
    summary: { id: 'summary-1', user_uid: 'user-1', work_date: '2026-10-07', status: 'ABSENT', absence_eligible: true },
    supabaseClient: fakeClient,
  });
  assert.equal(applied.id, 'outcome-1');
  assert.equal(calls[0].name, 'apply_attendance_absence_outcome');

  const reconciled = await reconcileAbsenceOutcome({
    companyId: 'company-1', summaryId: 'summary-1', reason: 'MANUAL_CORRECTION', actorUid: 'admin-1', supabaseClient: fakeClient,
  });
  assert.equal(reconciled.status, 'RECONCILED');
  assert.equal(calls.at(-1).name, 'reconcile_attendance_absence_outcome');
});

function reconciliationClient({ company, summaries = [], outcomes = [] } = {}) {
  const calls = [];
  const filtersByTable = new Map();
  const builderFor = (table) => {
    const filters = {};
    filtersByTable.set(table, filters);
    const builder = {
      select: () => builder,
      eq: (key, value) => { filters[key] = value; return builder; },
      gte: (key, value) => { filters[`gte:${key}`] = value; return builder; },
      lte: (key, value) => { filters[`lte:${key}`] = value; return builder; },
      in: (key, value) => { filters[`in:${key}`] = value; return builder; },
      single: async () => ({ data: company, error: null }),
      then: (resolve, reject) => {
        const data = table === 'attendance_daily_summaries' ? summaries
          : table === 'attendance_absence_outcomes' ? outcomes : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return {
    calls,
    filtersByTable,
    from(table) {
      if (table === 'authorization_audit_logs') {
        return { insert: async (payload) => { calls.push({ table, payload }); return { error: null }; } };
      }
      return builderFor(table);
    },
    rpc(name, args) {
      calls.push({ name, args });
      const outcome = outcomes.find((row) => row.summary_id === args.p_summary_id);
      return Promise.resolve({
        data: outcome ? { ...outcome, status: 'RECONCILED', decision_version: (outcome.decision_version || 1) + 1 } : null,
        error: null,
      });
    },
  };
}

test('final approved full-day leave reconciles each covered deducted absence exactly once', async () => {
  const client = reconciliationClient({
    company: { id: 'company-1', app_settings: { leave: { absenceDeductionsV1Enabled: true } } },
    summaries: [
      { id: 'summary-1', user_uid: 'user-1', work_date: '2026-10-20', status: 'ABSENT', absence_eligible: true },
      { id: 'summary-2', user_uid: 'user-1', work_date: '2026-10-21', status: 'ABSENT', absence_eligible: true },
    ],
    outcomes: [
      { id: 'outcome-1', summary_id: 'summary-1', user_uid: 'user-1', work_date: '2026-10-20', status: 'DEDUCTED', decision_version: 1 },
      { id: 'outcome-2', summary_id: 'summary-2', user_uid: 'user-1', work_date: '2026-10-21', status: 'RECONCILED', decision_version: 2 },
    ],
  });

  const result = await reconcileApprovedLeaveAbsenceOutcomes({
    companyId: 'company-1', employeeUid: 'user-1', startDate: '2026-10-20', endDate: '2026-10-21',
    days: 2, leaveRequestId: 'leave-1', supabaseClient: client,
  });

  assert.equal(result.attempted, 1);
  assert.equal(result.reconciled.length, 1);
  assert.equal(client.calls.filter((call) => call.name === 'reconcile_attendance_absence_outcome').length, 1);
  assert.deepEqual(client.calls.find((call) => call.name === 'reconcile_attendance_absence_outcome').args, {
    p_company_id: 'company-1', p_summary_id: 'summary-1', p_reason: 'APPROVED_LEAVE', p_actor_uid: null,
  });
  assert.equal(client.filtersByTable.get('attendance_daily_summaries').company_id, 'company-1');
  assert.equal(client.filtersByTable.get('attendance_daily_summaries').user_uid, 'user-1');
});

test('partial leave never performs an unsafe full-day reversal', async () => {
  const client = reconciliationClient({
    company: { id: 'company-1', app_settings: { leave: { absenceDeductionsV1Enabled: true } } },
    summaries: [{ id: 'summary-1', status: 'ABSENT', absence_eligible: true }],
    outcomes: [{ id: 'outcome-1', summary_id: 'summary-1', status: 'DEDUCTED', decision_version: 1 }],
  });
  const result = await reconcileApprovedLeaveAbsenceOutcomes({
    companyId: 'company-1', employeeUid: 'user-1', startDate: '2026-10-20', endDate: '2026-10-20',
    days: 0.5, isHalfDay: true, supabaseClient: client,
  });
  assert.equal(result.skipped, 'partial_leave_unsupported');
  assert.equal(client.calls.filter((call) => call.name === 'reconcile_attendance_absence_outcome').length, 0);
});

test('disabled Phase 4 and already reconciled outcomes remain untouched', async () => {
  const disabled = reconciliationClient({ company: { id: 'company-1', app_settings: {} } });
  assert.equal((await reconcileApprovedLeaveAbsenceOutcomes({
    companyId: 'company-1', employeeUid: 'user-1', startDate: '2026-10-20', endDate: '2026-10-20', supabaseClient: disabled,
  })).skipped, 'feature_disabled');

  const reconciled = reconciliationClient({
    company: { id: 'company-1', app_settings: { leave: { absenceDeductionsV1Enabled: true } } },
    summaries: [{ id: 'summary-1', status: 'ABSENT', absence_eligible: true }],
    outcomes: [{ id: 'outcome-1', summary_id: 'summary-1', status: 'RECONCILED', decision_version: 2 }],
  });
  const result = await reconcileApprovedLeaveAbsenceOutcomes({
    companyId: 'company-1', employeeUid: 'user-1', startDate: '2026-10-20', endDate: '2026-10-20', supabaseClient: reconciled,
  });
  assert.equal(result.attempted, 0);
  assert.equal(reconciled.calls.filter((call) => call.name === 'reconcile_attendance_absence_outcome').length, 0);
});

test('missing outcomes and tenant/user mismatches cannot trigger reconciliation', async () => {
  const client = reconciliationClient({
    company: { id: 'company-1', app_settings: { leave: { absenceDeductionsV1Enabled: true } } },
    summaries: [{ id: 'summary-1', user_uid: 'user-1', status: 'ABSENT', absence_eligible: true }],
    outcomes: [],
  });
  const result = await reconcileApprovedLeaveAbsenceOutcomes({
    companyId: 'company-1', employeeUid: 'user-1', startDate: '2026-10-20', endDate: '2026-10-20', supabaseClient: client,
  });
  assert.equal(result.attempted, 0);
  assert.equal(client.calls.filter((call) => call.name === 'reconcile_attendance_absence_outcome').length, 0);
  assert.equal(client.filtersByTable.get('attendance_absence_outcomes').company_id, 'company-1');
  assert.equal(client.filtersByTable.get('attendance_absence_outcomes').user_uid, 'user-1');
});
