/**
 * Reports API Routes
 * Handles manual report generation requests
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { generateReportData } = require('../services/reportFormatter');
const { generatePDF, savePDFToFile, deletePDFFile } = require('../services/pdfGenerator');
const { sendReportEmail, generateManualReportEmailBody } = require('../services/emailService');
const { getSuperAdminEmails, getReportSchedule, setReportSchedule } = require('../services/queryService');
const { supabase } = require('../config/supabase');
const { 
  generateReportId, 
  storeReport, 
  getReport, 
  deleteReport,
  cleanupExpiredReports 
} = require('../services/reportStorage');

/**
 * Middleware to verify super admin role
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
async function verifySuperAdmin(req, res, next) {
  try {
    // Get user from request (should be set by auth middleware)
    const userId = req.headers['x-user-id'];
    const userEmail = req.headers['x-user-email'];

    console.log(`[verifySuperAdmin] Received headers:`, { userId, userEmail });

    if (!userId && !userEmail) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User authentication required',
      });
    }

    // Query user from database to verify role
    // Prioritize email lookup as it's more reliable than ID matching
    let query = supabase.from('users').select('role, uid, id, email, username, company_id').eq('is_active', true);
    
    if (userEmail) {
      // Email lookup is most reliable - try this first
      query = query.eq('email', userEmail);
      console.log(`[verifySuperAdmin] Querying by email: ${userEmail}`);
    } else if (userId) {
      // Try both uid and id fields - use proper Supabase OR syntax
      // Format: (uid.eq.value,id.eq.value) - note the parentheses
      query = query.or(`uid.eq.${userId},id.eq.${userId}`);
      console.log(`[verifySuperAdmin] Querying by userId: ${userId}`);
    }

    const { data, error } = await query.single();

    // Log the query result for debugging
    console.log(`[verifySuperAdmin] Query result:`, { 
      found: !!data, 
      error: error?.message || null,
      userRole: data?.role || null,
      userId: data?.id || null,
      userUid: data?.uid || null,
      userEmail: data?.email || null,
      company_id: data?.company_id || null,
    });

    if (error) {
      console.error(`[verifySuperAdmin] Database query error:`, error);
      // If it's a "not found" error (PGRST116), provide more specific message
      if (error.code === 'PGRST116' || error.message?.includes('No rows')) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: `User not found in database. Searched with: ${userId ? `ID: ${userId}` : `Email: ${userEmail}`}`,
        });
      }
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User not found or inactive',
      });
    }

    if (!data) {
      console.warn(`[verifySuperAdmin] No user data returned from query`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User not found or inactive',
      });
    }

    if (data.role !== 'super_admin') {
      console.warn(`[verifySuperAdmin] User role mismatch. Expected: super_admin, Got: ${data.role}`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only super admins can generate reports',
      });
    }

    if (!data.company_id) {
      console.warn('[verifySuperAdmin] super_admin missing company_id');
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User missing tenant scope (company_id)',
      });
    }

    // User is verified as super admin
    console.log(`[verifySuperAdmin] ✓ User verified as super_admin: ${data.email || data.username}`);
    req.user = data;
    next();
  } catch (error) {
    console.error('[verifySuperAdmin] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to verify user permissions',
    });
  }
}

/**
 * Generate report
 * POST /api/reports/generate
 * 
 * Request body:
 * {
 *   "range": "weekly | monthly | yearly | all | custom",
 *   "from": "2026-01-01", // Optional, required for custom
 *   "to": "2026-01-31"     // Optional, required for custom
 * }
 */
router.post('/generate', verifySuperAdmin, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Received report generation request:`, req.body);

  try {
    const { range, from, to } = req.body;

    // Validate range
    const validRanges = ['weekly', 'monthly', 'yearly', 'all', 'custom'];
    if (!range || !validRanges.includes(range)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid range',
        message: `Range must be one of: ${validRanges.join(', ')}`,
      });
    }

    // Validate custom range
    if (range === 'custom' && (!from || !to)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid custom range',
        message: 'Custom range requires both "from" and "to" dates',
      });
    }

    // Generate unique report ID for download tracking
    const reportId = generateReportId();
    console.log(`[${timestamp}] Generated report ID: ${reportId}`);

    // Generate report data (async - don't wait)
    generateReportData(range, from, to, req.user.company_id)
      .then(async (reportData) => {
        console.log(`[${timestamp}] Report data generated:`, reportData.period.label);

        try {
          // Generate PDF
          const pdfBuffer = await generatePDF(reportData);
          console.log(`[${timestamp}] PDF generated (${pdfBuffer.length} bytes)`);

          // Save PDF to file using reportId
          const filename = `report-${reportId}.pdf`;
          const pdfPath = await savePDFToFile(pdfBuffer, filename);
          console.log(`[${timestamp}] PDF saved: ${pdfPath}`);

          // Store report metadata for download access
          storeReport(reportId, pdfPath, reportData);
          console.log(`[${timestamp}] Report metadata stored for download: ${reportId}`);

          // Get all super admin emails for THIS company only
          const recipients = await getSuperAdminEmails(req.user.company_id);
          if (recipients.length === 0) {
            throw new Error('No active super admin with a valid email found for this company');
          }

          const companyName = reportData.company?.name || req.user.company_id;
          const emailSubject = `Attendance Report — ${companyName} — ${reportData.period.label}`;
          const emailBody = generateManualReportEmailBody(reportData);

          await sendReportEmail(recipients, emailSubject, emailBody, pdfPath, filename);
          console.log(`[${timestamp}] ✓ Report sent to: ${recipients.join(', ')}`);

          // NOTE: Do NOT delete PDF immediately - it's needed for download
          // PDF will be cleaned up by expiration mechanism
        } catch (error) {
          console.error(`[${timestamp}] ✗ Error processing report:`, error);
          // Clean up report metadata on error
          deleteReport(reportId, deletePDFFile);
        }
      })
      .catch((error) => {
        console.error(`[${timestamp}] ✗ Error generating report:`, error);
        // Clean up report metadata on error
        deleteReport(reportId, deletePDFFile);
      });

    // Return immediately - report generation happens in background
    res.status(202).json({
      success: true,
      reportId: reportId,
      message: 'Report generation started. You will receive the report via email shortly. You can also download it using the report ID.',
      timestamp: timestamp,
    });
  } catch (error) {
    console.error(`[${timestamp}] Error handling report request:`, error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to initiate report generation',
    });
  }
});

/**
 * Download report
 * GET /api/reports/download/:reportId
 * 
 * Downloads a previously generated report by ID
 */
router.get('/download/:reportId', verifySuperAdmin, async (req, res) => {
  const timestamp = new Date().toISOString();
  const { reportId } = req.params;
  
  console.log(`[${timestamp}] Download request for report: ${reportId}`);
  
  try {
    // Get report metadata
    const report = getReport(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
        message: 'Report not found or has expired. Reports expire after 30 minutes.',
      });
    }
    
    // Check if file exists
    if (!fs.existsSync(report.filePath)) {
      console.error(`[${timestamp}] Report file not found: ${report.filePath}`);
      deleteReport(reportId);
      return res.status(404).json({
        success: false,
        error: 'Report file not found',
        message: 'The report file is no longer available.',
      });
    }
    
    // Generate filename for download
    const reportData = report.reportData;
    const periodLabel = reportData?.period?.label || 'report';
    const sanitizedLabel = periodLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const downloadFilename = `attendance-report-${sanitizedLabel}-${reportId.substring(0, 8)}.pdf`;
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', fs.statSync(report.filePath).size);
    
    // Stream the file
    const fileStream = fs.createReadStream(report.filePath);
    fileStream.pipe(res);
    
    fileStream.on('end', () => {
      console.log(`[${timestamp}] ✓ Report ${reportId} downloaded successfully`);
    });
    
    fileStream.on('error', (error) => {
      console.error(`[${timestamp}] ✗ Error streaming report ${reportId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Download failed',
          message: 'Error reading report file.',
        });
      }
    });
  } catch (error) {
    console.error(`[${timestamp}] Error handling download request:`, error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to download report',
    });
  }
});

/**
 * Health check
 * GET /api/reports/health
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Reports service is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get report schedule settings for the authenticated super admin's company.
 * GET /api/reports/schedule
 */
router.get('/schedule', verifySuperAdmin, async (req, res) => {
  try {
    const schedule = await getReportSchedule(req.user.company_id);
    res.json({ success: true, schedule });
  } catch (error) {
    console.error('[reports/schedule GET]', error);
    res.status(500).json({ success: false, error: 'Failed to load schedule settings' });
  }
});

/**
 * Update report schedule settings for the authenticated super admin's company.
 * PUT /api/reports/schedule
 * Body: { day?: number (1-28), autoSend?: boolean }
 */
router.put('/schedule', verifySuperAdmin, async (req, res) => {
  try {
    const { day, autoSend } = req.body;
    await setReportSchedule(req.user.company_id, { day, autoSend });
    const updated = await getReportSchedule(req.user.company_id);
    res.json({ success: true, schedule: updated });
  } catch (error) {
    console.error('[reports/schedule PUT]', error);
    res.status(400).json({ success: false, error: error.message || 'Failed to update schedule settings' });
  }
});

/**
 * Send report immediately for the authenticated super admin's company.
 * POST /api/reports/send-now
 */
router.post('/send-now', verifySuperAdmin, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Send-now triggered by ${req.user.email} for company ${req.user.company_id}`);

  try {
    const { triggerReportForCompany } = require('../jobs/monthlyReportJob');

    triggerReportForCompany(req.user.company_id)
      .then((result) => {
        console.log(`[${timestamp}] Send-now completed for company ${req.user.company_id}:`, result.status);
      })
      .catch((error) => {
        console.error(`[${timestamp}] Send-now failed for company ${req.user.company_id}:`, error);
      });

    res.status(202).json({
      success: true,
      message: 'Report generation started. You will receive the report via email shortly.',
      timestamp,
    });
  } catch (error) {
    console.error(`[${timestamp}] Error in send-now:`, error);
    res.status(500).json({ success: false, error: 'Failed to trigger report' });
  }
});

/**
 * TEST ENDPOINT: Trigger monthly report manually for all companies.
 * GET /api/reports/test/monthly
 */
router.get('/test/monthly', verifySuperAdmin, async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] TEST: Manual monthly report trigger requested`);

  try {
    const { triggerMonthlyReport } = require('../jobs/monthlyReportJob');

    triggerMonthlyReport()
      .then(() => console.log(`[${timestamp}] TEST: Monthly report generation completed`))
      .catch((error) => console.error(`[${timestamp}] TEST: Monthly report generation failed:`, error));

    res.status(202).json({
      success: true,
      message: 'Monthly report generation triggered. Check server logs and email for results.',
      timestamp,
    });
  } catch (error) {
    console.error(`[${timestamp}] TEST: Error triggering monthly report:`, error);
    res.status(500).json({ success: false, error: 'Failed to trigger monthly report' });
  }
});

module.exports = router;

