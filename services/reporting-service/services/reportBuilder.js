/**
 * Report Builder - Orchestrates report generation, storage, and optional email
 */
const { generateReportData } = require('./reportFormatter');
const { generatePDF, savePDFToFile, buildDownloadFilename } = require('./pdfGenerator');
const {
  generateReportId,
  storeReport,
  updateReport,
} = require('./reportStorage');
const { sendReportEmail, generateManualReportEmailBody } = require('./emailService');
const { getSuperAdminEmails } = require('./queryService');

async function buildReport({
  range,
  from,
  to,
  companyId,
  companyName,
  generatedBy,
  sendEmail = false,
}) {
  const reportId = generateReportId();
  const startMs = Date.now();

  console.log(`[ReportBuilder] Starting ${range} report for ${companyName} (${companyId})`);

  let reportData;
  try {
    reportData = await generateReportData(range, from, to, companyId, generatedBy);
  } catch (err) {
    console.error(`[ReportBuilder] Data generation failed:`, err.message);
    throw new Error('Report data generation failed. Please try again.');
  }

  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(reportData);
  } catch (err) {
    console.error(`[ReportBuilder] PDF generation failed:`, err.message);
    throw new Error('PDF generation failed. Please try again.');
  }

  const durationMs = Date.now() - startMs;
  const filename = buildDownloadFilename(reportData, reportId);

  let pdfPath;
  try {
    pdfPath = await savePDFToFile(pdfBuffer, filename);
  } catch (err) {
    console.error(`[ReportBuilder] PDF storage failed:`, err.message);
    throw new Error('Unable to store report. Storage may be unavailable.');
  }

  const record = storeReport({
    reportId,
    companyId,
    companyName: reportData.company.name,
    generatedBy,
    reportType: range,
    periodLabel: reportData.period.label,
    filePath: pdfPath,
    fileSize: pdfBuffer.length,
    emailStatus: 'not_sent',
    generationStatus: 'completed',
    reportData,
  });

  console.log(`[ReportBuilder] Report ${reportId} ready in ${durationMs}ms (${pdfBuffer.length} bytes)`);

  let emailStatus = 'not_sent';
  let emailError = null;

  if (sendEmail) {
    try {
      const recipients = await getSuperAdminEmails(companyId);
      if (recipients.length === 0) {
        emailStatus = 'skipped';
        emailError = 'No valid super admin email addresses found';
        console.warn(`[ReportBuilder] Email skipped — no recipients for ${companyName}`);
      } else {
        const subject = `Attendance Report — ${reportData.company.name} — ${reportData.period.label}`;
        const body = generateManualReportEmailBody(reportData);
        await sendReportEmail(recipients, subject, body, pdfPath, filename, {
          companyId,
          companyName: reportData.company.name,
          reportType: `${range} Attendance`,
        });
        emailStatus = 'sent';
        console.log(`[ReportBuilder] Email sent for report ${reportId}`);
      }
    } catch (err) {
      emailStatus = 'failed';
      emailError = err.message;
      console.error(`[ReportBuilder] Email failed for report ${reportId}:`, err.message);
    }
    updateReport(reportId, { emailStatus, emailError });
  }

  return {
    reportId,
    record: { ...record, emailStatus, emailError },
    durationMs,
    fileSize: pdfBuffer.length,
    periodLabel: reportData.period.label,
    downloadFilename: filename,
  };
}

async function emailExistingReport(report, companyId) {
  const recipients = await getSuperAdminEmails(companyId);
  if (recipients.length === 0) {
    throw new Error('No valid super admin email addresses found for this company');
  }

  const reportData = report.reportData;
  const filename = buildDownloadFilename(reportData, report.reportId);
  const subject = `Attendance Report — ${report.companyName} — ${report.periodLabel || reportData?.period?.label}`;
  const body = generateManualReportEmailBody(reportData);

  await sendReportEmail(recipients, subject, body, report.filePath, filename, {
    companyId,
    companyName: report.companyName,
    reportType: report.reportType,
  });

  updateReport(report.reportId, { emailStatus: 'sent', emailError: null });
  return { emailStatus: 'sent', recipients };
}

module.exports = {
  buildReport,
  emailExistingReport,
};
