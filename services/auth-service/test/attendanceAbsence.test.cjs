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
