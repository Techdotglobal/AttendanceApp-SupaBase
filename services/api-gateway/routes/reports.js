/**
 * Reports API Gateway Routes
 * Forwards report generation requests to reporting-service
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();

// Reporting service base URL
const REPORTING_SERVICE_URL = process.env.REPORTING_SERVICE_URL || 'http://localhost:3002';

// Log the reporting service URL on startup
console.log(`[API Gateway] Reporting Service URL configured: ${REPORTING_SERVICE_URL}`);
if (!process.env.REPORTING_SERVICE_URL) {
  console.warn(`[API Gateway] WARNING: REPORTING_SERVICE_URL not set, using default: ${REPORTING_SERVICE_URL}`);
  console.warn(`[API Gateway] For production, set REPORTING_SERVICE_URL environment variable`);
}

/**
 * Forward report generation request to reporting-service
 * POST /api/reports/generate
 */
router.post('/generate', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] API Gateway: Received report generation request`);
  
  try {
    // Forward user authentication headers
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // Forward user ID and email if available
    if (req.headers['x-user-id']) {
      headers['x-user-id'] = req.headers['x-user-id'];
    }
    if (req.headers['x-user-email']) {
      headers['x-user-email'] = req.headers['x-user-email'];
    }
    
    console.log(`[${timestamp}] API Gateway: Forwarding to Reporting Service at ${REPORTING_SERVICE_URL}/api/reports/generate`);
    const response = await axios.post(`${REPORTING_SERVICE_URL}/api/reports/generate`, req.body, {
      headers,
      timeout: 30000, // 30 second timeout for report generation
    });
    
    console.log(`[${timestamp}] API Gateway: Reporting Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Report generation forwarding error:`, error.message);
    console.error(`[${timestamp}] Reporting Service URL: ${REPORTING_SERVICE_URL}`);
    console.error(`[${timestamp}] Error details:`, {
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null,
      request: error.request ? 'Request made but no response' : null,
    });
    
    if (error.response) {
      // Reporting service responded with an error
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      // Request was made but no response received (service is down/unreachable)
      res.status(503).json({
        success: false,
        error: 'Reporting service unavailable',
        message: 'Unable to connect to reporting service. Please ensure the reporting service is deployed and running.',
        details: `Reporting service URL: ${REPORTING_SERVICE_URL}`,
      });
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      // Connection refused or timeout
      res.status(503).json({
        success: false,
        error: 'Reporting service unavailable',
        message: `Cannot connect to reporting service at ${REPORTING_SERVICE_URL}. The service may be down or not deployed.`,
        details: error.message,
      });
    } else {
      // Other errors
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * Forward report download request to reporting-service
 * GET /api/reports/download/:reportId
 */
router.get('/download/:reportId', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { reportId } = req.params;
  console.log(`[${timestamp}] API Gateway: Received report download request for: ${reportId}`);
  
  try {
    // Forward user authentication headers
    const headers = {};
    
    // Forward user ID and email if available (for auth verification)
    if (req.headers['x-user-id']) {
      headers['x-user-id'] = req.headers['x-user-id'];
    }
    if (req.headers['x-user-email']) {
      headers['x-user-email'] = req.headers['x-user-email'];
    }
    
    console.log(`[${timestamp}] API Gateway: Forwarding download to Reporting Service at ${REPORTING_SERVICE_URL}/api/reports/download/${reportId}`);
    
    // Forward download request with responseType 'stream' for binary data
    const response = await axios.get(`${REPORTING_SERVICE_URL}/api/reports/download/${reportId}`, {
      headers,
      responseType: 'stream',
      timeout: 60000, // 60 second timeout for download
    });
    
    console.log(`[${timestamp}] API Gateway: Reporting Service responded with status ${response.status}`);
    
    // Forward response headers
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
    res.setHeader('Content-Disposition', response.headers['content-disposition'] || `attachment; filename="report-${reportId}.pdf"`);
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    // Pipe the stream to client
    response.data.pipe(res);
    
    response.data.on('end', () => {
      console.log(`[${timestamp}] API Gateway: Report ${reportId} downloaded successfully`);
    });
    
    response.data.on('error', (error) => {
      console.error(`[${timestamp}] API Gateway: Error streaming report ${reportId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Download failed',
          message: 'Error downloading report file.',
        });
      }
    });
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Report download forwarding error:`, error.message);
    
    if (error.response) {
      // Reporting service responded with an error
      // Try to parse JSON error, otherwise forward status
      if (error.response.headers['content-type']?.includes('application/json')) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(error.response.status).send(error.response.data);
      }
    } else if (error.request) {
      // Request was made but no response received
      res.status(503).json({
        success: false,
        error: 'Reporting service unavailable',
        message: 'Unable to connect to reporting service. Please ensure the reporting service is deployed and running.',
      });
    } else {
      // Other errors
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * Get report schedule for the caller's company
 * GET /api/reports/schedule
 */
router.get('/schedule', async (req, res) => {
  try {
    const headers = {};
    if (req.headers['x-user-id']) headers['x-user-id'] = req.headers['x-user-id'];
    if (req.headers['x-user-email']) headers['x-user-email'] = req.headers['x-user-email'];

    const response = await axios.get(`${REPORTING_SERVICE_URL}/api/reports/schedule`, { headers, timeout: 10000 });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    res.status(503).json({ success: false, error: 'Reporting service unavailable' });
  }
});

/**
 * Update report schedule for the caller's company
 * PUT /api/reports/schedule
 */
router.put('/schedule', async (req, res) => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers['x-user-id']) headers['x-user-id'] = req.headers['x-user-id'];
    if (req.headers['x-user-email']) headers['x-user-email'] = req.headers['x-user-email'];

    const response = await axios.put(`${REPORTING_SERVICE_URL}/api/reports/schedule`, req.body, { headers, timeout: 10000 });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    res.status(503).json({ success: false, error: 'Reporting service unavailable' });
  }
});

/**
 * Send report now for the caller's company
 * POST /api/reports/send-now
 */
router.post('/send-now', async (req, res) => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers['x-user-id']) headers['x-user-id'] = req.headers['x-user-id'];
    if (req.headers['x-user-email']) headers['x-user-email'] = req.headers['x-user-email'];

    const response = await axios.post(`${REPORTING_SERVICE_URL}/api/reports/send-now`, {}, { headers, timeout: 30000 });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    res.status(503).json({ success: false, error: 'Reporting service unavailable' });
  }
});

/**
 * Health check
 * GET /api/reports/health
 */
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${REPORTING_SERVICE_URL}/api/reports/health`, {
      timeout: 5000,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Reporting service unavailable',
    });
  }
});

module.exports = router;

