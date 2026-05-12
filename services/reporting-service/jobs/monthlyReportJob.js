/**
 * Monthly Report Job - Automatically generates and emails monthly reports
 * Runs on the 1st of every month at 2 AM
 */
const cron = require('node-cron');
const { generateReportData } = require('../services/reportFormatter');
const { generatePDF } = require('../services/pdfGenerator');
const { savePDFToFile, deletePDFFile } = require('../services/pdfGenerator');
const { sendReportEmail, generateMonthlyReportEmailBody } = require('../services/emailService');
const { getSuperAdminEmail } = require('../services/queryService');
const { supabase } = require('../config/supabase');
const { getMonthName } = require('../utils/dateUtils');

let isRunning = false;

/**
 * Generate and send monthly report
 */
async function generateMonthlyReport() {
  if (isRunning) {
    console.log('⚠ Monthly report job is already running. Skipping...');
    return;
  }

  isRunning = true;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting monthly report generation...`);

  try {
    const { data: companies, error: companiesError } = await supabase.from('companies').select('id');
    if (companiesError) throw companiesError;
    const companyRows = companies || [];

    if (companyRows.length === 0) {
      console.warn(`[${timestamp}] No companies found — skipping monthly reports`);
      return;
    }

    for (const company of companyRows) {
      const companyId = company.id;
      try {
        const reportData = await generateReportData('monthly', null, null, companyId);

        console.log(`[${timestamp}] Report data generated for company ${companyId}`);
        console.log(`[${timestamp}] Period: ${reportData.period.label}`);
        console.log(`[${timestamp}] Total Employees: ${reportData.overall.totalEmployees}`);

        const pdfBuffer = await generatePDF(reportData);
        console.log(`[${timestamp}] PDF generated (${pdfBuffer.length} bytes) for company ${companyId}`);

        const now = new Date();
        const monthName = getMonthName(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        const filename = `monthly-report-${companyId.slice(0, 8)}-${monthName.toLowerCase()}-${now.getFullYear()}.pdf`;
        const pdfPath = await savePDFToFile(pdfBuffer, filename);
        console.log(`[${timestamp}] PDF saved to: ${pdfPath}`);

        const superAdminEmail = await getSuperAdminEmail(companyId);
        if (!superAdminEmail) {
          console.warn(`[${timestamp}] No super admin email for company ${companyId} — skipping send`);
          deletePDFFile(pdfPath);
          continue;
        }

        const emailSubject = `Monthly Attendance Report - ${reportData.period.label}`;
        const emailBody = generateMonthlyReportEmailBody(reportData);

        await sendReportEmail(superAdminEmail, emailSubject, emailBody, pdfPath, filename);
        console.log(`[${timestamp}] ✓ Monthly report sent for company ${companyId} to ${superAdminEmail}`);

        deletePDFFile(pdfPath);
        console.log(`[${timestamp}] Temporary PDF file deleted`);
      } catch (companyErr) {
        console.error(`[${timestamp}] ✗ Error for company ${company?.id}:`, companyErr);
      }
    }
  } catch (error) {
    console.error(`[${timestamp}] ✗ Error generating monthly report:`, error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the monthly report cron job
 * Runs on the 1st of every month at 2 AM
 */
function startMonthlyReportJob() {
  // Cron expression: "0 2 1 * *" = At 02:00 on day-of-month 1
  cron.schedule('0 2 1 * *', async () => {
    await generateMonthlyReport();
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log('✓ Monthly report job scheduled: Runs on 1st of every month at 2:00 AM UTC');
}

/**
 * Manually trigger monthly report (for testing)
 */
async function triggerMonthlyReport() {
  await generateMonthlyReport();
}

module.exports = {
  startMonthlyReportJob,
  triggerMonthlyReport,
  generateMonthlyReport,
};

