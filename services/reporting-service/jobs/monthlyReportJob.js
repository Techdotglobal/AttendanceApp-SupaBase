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
const { generateReportData } = require('../services/reportFormatter');
const { generatePDF, savePDFToFile, deletePDFFile } = require('../services/pdfGenerator');
const { sendReportEmail, generateMonthlyReportEmailBody } = require('../services/emailService');
const { getAllCompanies, getSuperAdminEmails, getReportSchedule, logReportAudit } = require('../services/queryService');
const { getMonthName } = require('../utils/dateUtils');

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

  // Step 1: Fetch super admin emails for THIS company only
  let recipients;
  try {
    recipients = await getSuperAdminEmails(companyId);
  } catch (err) {
    const msg = `Failed to fetch super admin emails: ${err.message}`;
    console.error(`[${ts()}]   ✗ ${companyName}: ${msg}`);
    await logReportAudit({ companyId, companyName, status: 'error', errorMessage: msg });
    return { companyId, companyName, status: 'error', error: msg };
  }

  if (recipients.length === 0) {
    const msg = 'No active super_admin with a valid email address — skipping';
    console.warn(`[${ts()}]   ⚠ ${companyName}: ${msg}`);
    await logReportAudit({ companyId, companyName, status: 'skipped', errorMessage: msg });
    return { companyId, companyName, status: 'skipped' };
  }

  console.log(`[${ts()}]   Recipients (${recipients.length}): ${recipients.join(', ')}`);

  // Step 2: Generate report using ONLY this company's data
  let reportData;
  try {
    reportData = await generateReportData('monthly', null, null, companyId);
  } catch (err) {
    const msg = `Report data generation failed: ${err.message}`;
    console.error(`[${ts()}]   ✗ ${companyName}: ${msg}`);
    await logReportAudit({ companyId, companyName, recipients, status: 'error', errorMessage: msg });
    return { companyId, companyName, status: 'error', error: msg };
  }

  console.log(`[${ts()}]   Period: ${reportData.period.label}`);
  console.log(`[${ts()}]   Total employees: ${reportData.overall.totalEmployees}`);

  // Step 3: Generate PDF
  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(reportData);
    console.log(`[${ts()}]   PDF generated (${pdfBuffer.length} bytes)`);
  } catch (err) {
    const msg = `PDF generation failed: ${err.message}`;
    console.error(`[${ts()}]   ✗ ${companyName}: ${msg}`);
    await logReportAudit({ companyId, companyName, reportPeriod: reportData.period.label, recipients, status: 'error', errorMessage: msg });
    return { companyId, companyName, status: 'error', error: msg };
  }

  // Save PDF to a temp file
  const now = new Date();
  const monthName = getMonthName(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const filename = `monthly-report-${companyId.slice(0, 8)}-${monthName.toLowerCase()}-${now.getFullYear()}.pdf`;
  let pdfPath;
  try {
    pdfPath = await savePDFToFile(pdfBuffer, filename);
    console.log(`[${ts()}]   PDF saved: ${pdfPath}`);
  } catch (err) {
    const msg = `PDF save failed: ${err.message}`;
    console.error(`[${ts()}]   ✗ ${companyName}: ${msg}`);
    await logReportAudit({ companyId, companyName, reportPeriod: reportData.period.label, recipients, status: 'error', errorMessage: msg });
    return { companyId, companyName, status: 'error', error: msg };
  }

  // Step 4: Send email ONLY to this company's super admins
  let emailResult;
  try {
    const emailSubject = `Monthly Attendance Report — ${companyName} — ${reportData.period.label}`;
    const emailBody = generateMonthlyReportEmailBody(reportData);
    emailResult = await sendReportEmail(recipients, emailSubject, emailBody, pdfPath, filename);
    console.log(`[${ts()}]   ✓ Email sent (Resend id=${emailResult.messageId}) to: ${recipients.join(', ')}`);
  } catch (err) {
    const msg = `Email delivery failed: ${err.message}`;
    console.error(`[${ts()}]   ✗ ${companyName}: ${msg}`);
    deletePDFFile(pdfPath);
    await logReportAudit({ companyId, companyName, reportPeriod: reportData.period.label, recipients, status: 'error', errorMessage: msg });
    return { companyId, companyName, status: 'error', error: msg };
  }

  // Step 5: Cleanup and audit
  deletePDFFile(pdfPath);
  await logReportAudit({
    companyId,
    companyName,
    reportPeriod: reportData.period.label,
    recipients,
    status: 'sent',
  });

  return { companyId, companyName, status: 'sent', recipients };
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
