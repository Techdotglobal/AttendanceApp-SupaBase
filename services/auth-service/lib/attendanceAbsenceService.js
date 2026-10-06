const { supabase } = require('../config/supabase');
const { writeAuthorizationAudit } = require('./permissions');

const ABSENCE_ACTIONS = new Set(['NONE', 'DEDUCT_LEAVE', 'UNPAID_ABSENCE']);
const INSUFFICIENT_POLICIES = new Set(['CAP_AT_ZERO_UNPAID', 'ALLOW_NEGATIVE', 'NO_DEDUCTION']);

function absenceFeatureEnabled(company) {
  return company?.app_settings?.leave?.absenceDeductionsV1Enabled === true
    || company?.app_settings?.absence_deductions_v1_enabled === true;
}

function normalizePolicy(row) {
  const action = String(row?.action || 'NONE').toUpperCase();
  const insufficient = String(row?.insufficient_balance_policy || 'CAP_AT_ZERO_UNPAID').toUpperCase();
  return {
    id: row?.id || null,
    enabled: row?.enabled === true,
    action: ABSENCE_ACTIONS.has(action) ? action : 'NONE',
    leave_type: row?.leave_type ? String(row.leave_type).toLowerCase() : null,
    deduction_days: Math.max(0, Number(row?.deduction_days ?? 1)),
    insufficient_balance_policy: INSUFFICIENT_POLICIES.has(insufficient) ? insufficient : 'CAP_AT_ZERO_UNPAID',
    effective_from: row?.effective_from || null,
  };
}

async function loadAbsencePolicy(companyId, client = supabase) {
  const { data, error } = await client
    .from('attendance_absence_policies')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return normalizePolicy(data);
}

function policyApplies(policy, workDate) {
  if (!policy.enabled || policy.action === 'NONE') return false;
  if (!policy.effective_from) return false;
  return String(workDate).slice(0, 10) >= String(policy.effective_from).slice(0, 10);
}

async function processAbsenceOutcome({ company, summary, mode = 'active', supabaseClient = supabase }) {
  if (!summary?.id || mode !== 'active') return null;

  // Keep the legacy finalization path completely inert while the additive
  // feature is disabled (and during a staged deployment before its migration
  // is present). Existing outcomes are reconciled only while the feature is
  // enabled; disabling the flag is the documented rollback mechanism.
  if (!absenceFeatureEnabled(company)) return null;

  if (summary.status === 'ABSENT' && summary.absence_eligible === true) {
    const policy = await loadAbsencePolicy(company.id, supabaseClient);
    if (!policyApplies(policy, summary.work_date)) return null;
    const { data, error } = await supabaseClient.rpc('apply_attendance_absence_outcome', {
      p_company_id: company.id,
      p_summary_id: summary.id,
      p_user_uid: summary.user_uid,
      p_work_date: summary.work_date,
      p_policy: policy,
      p_source: 'system',
    });
    if (error) throw error;
    const { data: adjustments } = await supabaseClient
      .from('leave_balance_adjustments')
      .select('id, transaction_type, amount, cycle')
      .eq('company_id', company.id)
      .eq('outcome_id', data.id);
    await writeAuthorizationAudit(supabaseClient, {
      companyId: company.id,
      actorUid: null,
      targetUid: summary.user_uid,
      action: 'attendance_absence_outcome_applied',
      afterState: data,
      metadata: {
        summary_id: summary.id,
        work_date: summary.work_date,
        source: 'system',
        adjustment_ids: (adjustments || []).map((row) => row.id),
      },
    });
    return data;
  }

  // A manual attendance correction, approved leave, or an explicit holiday/off
  // day recalculation can make an existing absence outcome ineligible. The
  // reconciliation RPC is idempotent and reverses only this outcome's ledger.
  const companyId = company.id;
  const summaryId = summary.id;
  const reason = summary.leave_request_id ? 'APPROVED_LEAVE' : 'ATTENDANCE_RECORDED_OR_DAY_EXEMPT';
  const actorUid = null;
  const { data, error } = await supabaseClient.rpc('reconcile_attendance_absence_outcome', {
    p_company_id: company.id,
    p_summary_id: summary.id,
    p_reason: summary.leave_request_id ? 'APPROVED_LEAVE' : 'ATTENDANCE_RECORDED_OR_DAY_EXEMPT',
    p_actor_uid: null,
  });
  if (error) throw error;
  if (data) {
    const { data: adjustments } = await supabaseClient
      .from('leave_balance_adjustments')
      .select('id, transaction_type, amount, cycle')
      .eq('company_id', companyId)
      .eq('outcome_id', data.id);
    await writeAuthorizationAudit(supabaseClient, {
      companyId,
      actorUid: actorUid || null,
      targetUid: data.user_uid || null,
      action: 'attendance_absence_outcome_reconciled',
      afterState: data,
      metadata: {
        summary_id: summaryId,
        reason,
        source: actorUid ? 'manual' : 'system',
        adjustment_ids: (adjustments || []).map((row) => row.id),
      },
    });
  }
  return data;
}

async function reconcileAbsenceOutcome({ companyId, summaryId, reason, actorUid = null, supabaseClient = supabase }) {
  const { data, error } = await supabaseClient.rpc('reconcile_attendance_absence_outcome', {
    p_company_id: companyId,
    p_summary_id: summaryId,
    p_reason: reason,
    p_actor_uid: actorUid,
  });
  if (error) throw error;
  return data;
}

module.exports = {
  ABSENCE_ACTIONS,
  INSUFFICIENT_POLICIES,
  absenceFeatureEnabled,
  normalizePolicy,
  loadAbsencePolicy,
  policyApplies,
  processAbsenceOutcome,
  reconcileAbsenceOutcome,
};
