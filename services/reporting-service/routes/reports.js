/**
 * Reports API Routes
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const { buildReport, emailExistingReport } = require('../services/reportBuilder');
const { buildDownloadFilename } = require('../services/pdfGenerator');
const { deletePDFFile } = require('../services/pdfGenerator');
const {
  getReport,
  deleteReport,
  getReportsByCompany,
  getLatestReport,
  verifyReportAccess,
  toPublicRecord,
} = require('../services/reportStorage');
const { getSuperAdminEmails, getReportSchedule, setReportSchedule } = require('../services/queryService');
const { supabase } = require('../config/supabase');

const VALID_RANGES = ['daily', 'weekly', 'monthly', 'yearly', 'all', 'custom'];

function parseUserFromRequest(req) {
  let userId = req.headers['x-user-id'];
  let userEmail = req.headers['x-user-email'];

  const ctx = req.headers['x-user-context'];
  if (ctx) {
    try {
      const user = JSON.parse(ctx);
      if (!userEmail && user.email) userEmail = user.email;
      if (!userId && (user.uid || user.id)) userId = user.uid || user.id;
    } catch (_) {}
  }

  return { userId, userEmail };
}

async function verifySuperAdmin(req, res, next) {
  try {
    const { userId, userEmail } = parseUserFromRequest(req);

    if (!userId && !userEmail) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User authentication required',
      });
    }

    let query = supabase.from('users').select('role, uid, id, email, username, company_id, name').eq('is_active', true);

    if (userEmail) {
      query = query.eq('email', userEmail);
    } else {
      query = query.or(`uid.eq.${userId},id.eq.${userId}`);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User not found or inactive',
      });
    }

    if (data.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only super admins can access reports',
      });
    }

    if (!data.company_id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User missing tenant scope (company_id)',
      });
    }

    req.user = data;
    next();
  } catch (error) {
    console.error('[verifySuperAdmin] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to verify user permissions',
    });
  }
}

function validateRangeBody(req, res) {
  const { range, from, to } = req.body;
  if (!range || !VALID_RANGES.includes(range)) {
    res.status(400).json({
      success: false,
      error: 'Invalid range',
      message: `Range must be one of: ${VALID_RANGES.join(', ')}`,
    });
    return null;
  }
  if (range === 'custom' && (!from || !to)) {
    res.status(400).json({
      success: false,
      error: 'Invalid custom range',
      message: 'Custom range requires both "from" and "to" dates',
    });
    return null;
  }
  return { range, from, to };
}

function getGeneratedBy(user) {
  return user.name || user.email || user.username || 'Super Admin';
}

function streamReportFile(req, res, report, disposition) {
  const timestamp = new Date().toISOString();

  if (!verifyReportAccess(report, req.user.company_id)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'You do not have access to this report',
    });
  }

  if (!fs.existsSync(report.filePath)) {
    deleteReport(report.reportId);
    return res.status(404).json({
      success: false,
      error: 'Report not found',
      message: 'Unable to load report. The file is no longer available.',
    });
  }

  const downloadFilename = buildDownloadFilename(report.reportData, report.reportId);
  const stat = fs.statSync(report.filePath);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${downloadFilename}"`);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const fileStream = fs.createReadStream(report.filePath);
  fileStream.pipe(res);

  fileStream.on('end', () => {
    console.log(`[${timestamp}] ${disposition === 'inline' ? 'Preview' : 'Download'}: report ${report.reportId}`);
  });

  fileStream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Server error',
        message: 'Unable to load report',
      });
    }
  });
}

// ── Generate PDF only (no email) ──────────────────────────────────────────
router.post('/generate-pdf', verifySuperAdmin, async (req, res) => {
  const params = validateRangeBody(req, res);
  if (!params) return;

  try {
    const result = await buildReport({
      ...params,
      companyId: req.user.company_id,
      companyName: req.user.company_id,
      generatedBy: getGeneratedBy(req.user),
      sendEmail: false,
    });

    res.status(200).json({
      success: true,
      reportId: result.reportId,
      message: 'Report generated successfully.',
      periodLabel: result.periodLabel,
      fileSize: result.fileSize,
      durationMs: result.durationMs,
      report: toPublicRecord(result.record),
    });
  } catch (error) {
    console.error('[generate-pdf] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Generation failed',
      message: error.message || 'PDF generation failed',
    });
  }
});

// ── Generate PDF and email ──────────────────────────────────────────────────
router.post('/generate-and-email', verifySuperAdmin, async (req, res) => {
  const params = validateRangeBody(req, res);
  if (!params) return;

  try {
    const result = await buildReport({
      ...params,
      companyId: req.user.company_id,
      generatedBy: getGeneratedBy(req.user),
      sendEmail: true,
    });

    const emailMsg = result.record.emailStatus === 'sent'
      ? 'Report generated and emailed successfully.'
      : result.record.emailStatus === 'failed'
        ? `Report generated but email failed: ${result.record.emailError}`
        : 'Report generated. Email was skipped (no recipients).';

    res.status(200).json({
      success: true,
      reportId: result.reportId,
      message: emailMsg,
      periodLabel: result.periodLabel,
      fileSize: result.fileSize,
      durationMs: result.durationMs,
      emailStatus: result.record.emailStatus,
      report: toPublicRecord(result.record),
    });
  } catch (error) {
    console.error('[generate-and-email] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Generation failed',
      message: error.message || 'PDF generation failed',
    });
  }
});

// Backward-compatible alias: generate PDF only (no longer auto-emails)
router.post('/generate', verifySuperAdmin, async (req, res) => {
  const params = validateRangeBody(req, res);
  if (!params) return;

  try {
    const result = await buildReport({
      ...params,
      companyId: req.user.company_id,
      generatedBy: getGeneratedBy(req.user),
      sendEmail: false,
    });

    res.status(200).json({
      success: true,
      reportId: result.reportId,
      message: 'Report generated successfully.',
      periodLabel: result.periodLabel,
      fileSize: result.fileSize,
      durationMs: result.durationMs,
      report: toPublicRecord(result.record),
    });
  } catch (error) {
    console.error('[generate] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Generation failed',
      message: error.message || 'PDF generation failed',
    });
  }
});

// ── Preview PDF (inline) ────────────────────────────────────────────────────
router.get('/preview/:reportId', verifySuperAdmin, (req, res) => {
  const report = getReport(req.params.reportId);
  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Report not found',
      message: 'Report not found or has expired.',
    });
  }
  streamReportFile(req, res, report, 'inline');
});

// ── Download PDF (attachment) ─────────────────────────────────────────────────
router.get('/download/:reportId', verifySuperAdmin, (req, res) => {
  const report = getReport(req.params.reportId);
  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Report not found',
      message: 'Report not found or has expired.',
    });
  }
  streamReportFile(req, res, report, 'attachment');
});

// ── Email existing report ─────────────────────────────────────────────────────
router.post('/email/:reportId', verifySuperAdmin, async (req, res) => {
  const report = getReport(req.params.reportId);
  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Report not found',
      message: 'Report not found or has expired.',
    });
  }

  if (!verifyReportAccess(report, req.user.company_id)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'You do not have access to this report',
    });
  }

  try {
    const result = await emailExistingReport(report, req.user.company_id);
    res.json({
      success: true,
      message: 'Report emailed successfully.',
      emailStatus: result.emailStatus,
      recipients: result.recipients,
    });
  } catch (error) {
    console.error('[email] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Email failed',
      message: error.message || 'Email delivery failed',
    });
  }
});

// ── Report history ────────────────────────────────────────────────────────────
router.get('/history', verifySuperAdmin, (req, res) => {
  const reports = getReportsByCompany(req.user.company_id);
  res.json({ success: true, reports });
});

// ── Latest report ─────────────────────────────────────────────────────────────
router.get('/latest', verifySuperAdmin, (req, res) => {
  const report = getLatestReport(req.user.company_id);
  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Not found',
      message: 'No reports have been generated yet.',
    });
  }
  res.json({ success: true, report });
});

// ── Delete report ─────────────────────────────────────────────────────────────
router.delete('/:reportId', verifySuperAdmin, (req, res) => {
  const report = getReport(req.params.reportId);
  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Report not found',
      message: 'Report not found or has expired.',
    });
  }

  if (!verifyReportAccess(report, req.user.company_id)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'You do not have access to this report',
    });
  }

  deleteReport(req.params.reportId, deletePDFFile);
  res.json({ success: true, message: 'Report deleted successfully.' });
});

// ── Schedule recipients summary ───────────────────────────────────────────────
router.get('/recipients', verifySuperAdmin, async (req, res) => {
  try {
    const recipients = await getSuperAdminEmails(req.user.company_id);
    res.json({ success: true, recipients, count: recipients.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load recipients' });
  }
});

// ── Schedule settings ─────────────────────────────────────────────────────────
router.get('/schedule', verifySuperAdmin, async (req, res) => {
  try {
    const schedule = await getReportSchedule(req.user.company_id);
    const recipients = await getSuperAdminEmails(req.user.company_id);
    res.json({ success: true, schedule: { ...schedule, recipients } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load schedule settings' });
  }
});

router.put('/schedule', verifySuperAdmin, async (req, res) => {
  try {
    const { day, autoSend, frequency } = req.body;
    await setReportSchedule(req.user.company_id, { day, autoSend, frequency });
    const updated = await getReportSchedule(req.user.company_id);
    const recipients = await getSuperAdminEmails(req.user.company_id);
    res.json({ success: true, schedule: { ...updated, recipients } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Failed to update schedule settings' });
  }
});

router.post('/send-now', verifySuperAdmin, async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    const { triggerReportForCompany } = require('../jobs/monthlyReportJob');
    triggerReportForCompany(req.user.company_id).catch((err) => {
      console.error(`[send-now] Failed:`, err.message);
    });
    res.status(202).json({
      success: true,
      message: 'Scheduled report generation started. You will receive the report via email shortly.',
      timestamp,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to trigger report' });
  }
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Reports service is running', timestamp: new Date().toISOString() });
});

module.exports = router;
