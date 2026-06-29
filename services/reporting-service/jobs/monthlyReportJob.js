/**
 * Monthly Report Job - Generates and emails monthly reports per company
 * Cron: 1st of every month at 2:00 AM UTC
 *
 * Flow per company:
 *   1. Fetch company (id + name)
 *   2. Fetch ALL active super_admin users for that company only
 *   3. Generate report using only that company's data
 *   4. Send report to those super admin email addresses only
 *   5. Write audit log entry
 */
const cron = require('node-cron');
const { buildReport } = require('../services/reportBuilder');
const { getAllCompanies, getReportSchedule, logReportAudit } = require('../services/queryService');
const { recordScheduleExecution } = require('../services/scheduleConfig');

let isRunning = false;

/**
 * Process a single company: generate its report and email all super admins.
 * Returns a result object; never throws — caller continues to next company.
 */
async function processCompany(company) {
  const companyId = company.id;
  const companyName = company.name || `Company ${companyId.slice(0, 8)}`;
  const ts = () => new Date().toISOString();

  console.log(`[${ts()}] ── Processing company: "${companyName}" (${companyId})`);

  try {
    const result = await buildReport({
      range: 'monthly',
      companyId,
      companyName,
      generatedBy: 'Hadir.AI Scheduled Reports',
      sendEmail: true,
    });

    if (result.record.emailStatus === 'sent') {
      await logReportAudit({
        companyId,
        companyName,
        reportPeriod: result.periodLabel,
        status: 'sent',
      });
      recordScheduleExecution(companyId, 'sent');
      console.log(`[${ts()}]   ✓ Monthly report sent for ${companyName}`);
      return { companyId, companyName, status: 'sent', reportId: result.reportId };
    }

    if (result.record.emailStatus === 'skipped') {
      const msg = 'No active super_admin with a valid email address — skipping';
      await logReportAudit({ companyId, companyName, status: 'skipped', errorMessage: msg });
      recordScheduleExecution(companyId, 'skipped');
      return { companyId, companyName, status: 'skipped' };
    }

    const msg = result.record.emailError || 'Email delivery failed';
    await logReportAudit({ companyId, companyName, reportPeriod: result.periodLabel, status: 'error', errorMessage: msg });
    recordScheduleExecution(companyId, 'error');
    return { companyId, companyName, status: 'error', error: msg };
  } catch (err) {
    const msg = err.message || 'Report generation failed';
    console.error(`[${ts()}]   ✗ ${companyName}: ${msg}`);
    await logReportAudit({ companyId, companyName, status: 'error', errorMessage: msg });
    recordScheduleExecution(companyId, 'error');
    return { companyId, companyName, status: 'error', error: msg };
  }
}

/**
 * Main entry point: iterate all companies, process each independently.
 * @param {boolean} [force=false] When true, ignores schedule settings and sends immediately.
 */
async function generateMonthlyReport(force = false) {
  if (isRunning) {
    console.log('⚠ Monthly report job is already running. Skipping...');
    return;
  }

  isRunning = true;
  const ts = () => new Date().toISOString();
  console.log(`\n[${ts()}] ══════════════════════════════════════════`);
  console.log(`[${ts()}] Starting monthly report job`);
  console.log(`[${ts()}] ══════════════════════════════════════════`);

  try {
    const companies = await getAllCompanies();

    if (companies.length === 0) {
      console.warn(`[${ts()}] No companies found — nothing to report`);
      return;
    }

    console.log(`[${ts()}] Companies to process: ${companies.length}${force ? ' (forced send — ignoring schedule)' : ''}`);
    const todayDay = new Date().getUTCDate();
    const results = { sent: [], skipped: [], errors: [] };

    for (const company of companies) {
      // Each company is fully isolated — one failure never aborts the loop

      if (!force) {
        // Respect per-company schedule: only send if today is the configured day
        const schedule = await getReportSchedule(company.id);
        if (!schedule.autoSend) {
          console.log(`[${ts()}]   ⏸ ${company.name || company.id}: auto-send disabled — skipping`);
          results.skipped.push(company.name || company.id);
          continue;
        }
        if (schedule.day !== todayDay) {
          console.log(`[${ts()}]   ⏳ ${company.name || company.id}: scheduled for day ${schedule.day}, today is day ${todayDay} — skipping`);
          results.skipped.push(company.name || company.id);
          continue;
        }
      }

      const result = await processCompany(company);
      if (result.status === 'sent') results.sent.push(result.companyName);
      else if (result.status === 'skipped') results.skipped.push(result.companyName);
      else results.errors.push(`${result.companyName}: ${result.error}`);
    }

    console.log(`\n[${ts()}] ── Monthly report job complete ──────────`);
    console.log(`[${ts()}]   ✓ Sent     (${results.sent.length}): ${results.sent.join(', ') || 'none'}`);
    console.log(`[${ts()}]   ⚠ Skipped  (${results.skipped.length}): ${results.skipped.join(', ') || 'none'}`);
    console.log(`[${ts()}]   ✗ Errors   (${results.errors.length}): ${results.errors.join(' | ') || 'none'}`);
    console.log(`[${ts()}] ─────────────────────────────────────────\n`);
  } catch (error) {
    console.error(`[${ts()}] ✗ Fatal error in monthly report job:`, error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the monthly report cron job.
 * Runs daily at 02:00 UTC. For each company, checks its report_schedule_day setting
 * and only sends when today's UTC day-of-month matches that setting.
 */
function startMonthlyReportJob() {
  cron.schedule('0 2 * * *', async () => {
    await generateMonthlyReport(false);
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log('✓ Monthly report job scheduled: runs daily at 02:00 AM UTC (per-company day checked at runtime)');
}

/**
 * Manually trigger monthly report (bypasses schedule check).
 * Used for the "Send Now" button and the /test/monthly endpoint.
 */
async function triggerMonthlyReport() {
  await generateMonthlyReport(true);
}

/**
 * Send a report for a single specific company (bypasses schedule check).
 * Used when a super admin clicks "Send Now" for their own company.
 * @param {string} companyId
 */
async function triggerReportForCompany(companyId) {
  const { getCompany } = require('../services/queryService');
  const company = await getCompany(companyId);
  if (!company) throw new Error(`Company ${companyId} not found`);
  return processCompany(company);
}

module.exports = {
  startMonthlyReportJob,
  triggerMonthlyReport,
  triggerReportForCompany,
  generateMonthlyReport,
};
