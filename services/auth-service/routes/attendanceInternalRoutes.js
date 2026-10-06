const express = require('express');
const { supabase } = require('../config/supabase');
const { finalizeCompanyDay } = require('../lib/attendanceFinalizer');
const { withAttendanceFinalizationLock } = require('../lib/attendanceFinalizationLock');
const { normalizeSecret, secretsMatch, assertProductionSecret } = require('../../../shared/security/internalSecret.cjs');

const router = express.Router();

function validSecret(req) {
  const configured = normalizeSecret(process.env.INTERNAL_API_SECRET);
  const presented = normalizeSecret(req.get('x-internal-auth') || req.get('x-attendance-job-secret'));
  return secretsMatch(configured, presented);
}

assertProductionSecret(process.env, 'attendance internal routes');

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

router.post('/finalize', async (req, res) => {
  if (!validSecret(req)) return res.status(401).json({ success: false, error: 'Internal attendance job authentication failed' });
  const mode = String(req.body?.mode || 'active').toLowerCase() === 'observe' ? 'observe' : 'active';
  const workDate = String(req.body?.work_date || '').trim();
  if (!validDate(workDate)) return res.status(400).json({ success: false, error: 'work_date must be YYYY-MM-DD' });

  try {
    const requestedCompanyId = req.body?.company_id ? String(req.body.company_id) : null;
    const { data: companies, error: companyError } = await supabase.from('companies').select('id, app_settings');
    if (companyError) throw companyError;
    // Always apply the tenant feature flag before acquiring a lock or writing
    // finalization-run state. An explicit company_id is only a selector; it
    // must never bypass the Phase 3 rollout gate.
    const enabledCompanies = (companies || []).filter((company) =>
      company?.app_settings?.attendance_rules_v1_enabled === true
      || company?.app_settings?.attendance?.rulesV1Enabled === true
    );
    const companyIds = enabledCompanies
      .filter((company) => !requestedCompanyId || String(company.id) === requestedCompanyId)
      .map((company) => company.id);

    const results = [];
    for (const companyId of companyIds) {
      const locked = await withAttendanceFinalizationLock(supabase, { companyId, workDate, mode }, async ({ lockLost }) => {
        let run = null;
        if (mode === 'active') {
          const { data, error } = await supabase
            .from('attendance_finalization_runs')
            .upsert({ company_id: companyId, work_date: workDate, mode, status: 'running', attempt_count: 1, started_at: new Date().toISOString(), error_message: null }, { onConflict: 'company_id,work_date,mode' })
            .select('*')
            .single();
          if (error) throw error;
          run = data;
        }
        try {
          const result = await finalizeCompanyDay({ companyId, workDate, mode, now: new Date(), userUid: req.body?.user_uid || null });
          const lost = lockLost();
          if (lost) throw lost;
          if (run) await supabase.from('attendance_finalization_runs').update({ status: 'completed', completed_at: new Date().toISOString(), error_message: null }).eq('id', run.id);
          return result;
        } catch (error) {
          if (run) await supabase.from('attendance_finalization_runs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: error.message }).eq('id', run.id);
          throw error;
        }
      });
      results.push(locked.acquired ? locked.result : { company_id: companyId, work_date: workDate, mode, skipped: true, reason: 'locked' });
    }
    return res.json({ success: true, mode, work_date: workDate, results });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Attendance finalization failed' });
  }
});

module.exports = router;
module.exports.validSecret = validSecret;
