/**
 * Reports API Gateway Routes
 * Forwards report generation requests to reporting-service
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();

// Reporting service base URL
const REPORTING_SERVICE_URL = process.env.REPORTING_SERVICE_URL || 'http://localhost:3002';

console.log(`[API Gateway] Reporting Service URL configured: ${REPORTING_SERVICE_URL}`);

/**
 * Extract x-user-id and x-user-email from the x-user-context header
 * (set by the frontend axios interceptor as JSON.stringify(user)).
 * Falls back to raw x-user-id / x-user-email if already present.
 */
function buildAuthHeaders(req) {
  const headers = { 'Content-Type': 'application/json' };

  // Prefer explicit headers if already set
  if (req.headers['x-user-email']) {
    headers['x-user-email'] = req.headers['x-user-email'];
  }
  if (req.headers['x-user-id']) {
    headers['x-user-id'] = req.headers['x-user-id'];
  }

  // Parse x-user-context sent by the web client
  const ctx = req.headers['x-user-context'];
  if (ctx && !headers['x-user-email']) {
    try {
      const user = JSON.parse(ctx);
      if (user.email) headers['x-user-email'] = user.email;
      if (!headers['x-user-id'] && (user.uid || user.id)) {
        headers['x-user-id'] = user.uid || user.id;
      }
    } catch (_) {}
  }

  return headers;
}

const proxyError = (res, error) => {
  if (error.response) return res.status(error.response.status).json(error.response.data);
  if (error.request) return res.status(503).json({ success: false, error: 'Reporting service unavailable' });
  res.status(500).json({ success: false, error: error.message });
};

router.post('/generate', async (req, res) => {
  try {
    const response = await axios.post(`${REPORTING_SERVICE_URL}/api/reports/generate`, req.body, {
      headers: buildAuthHeaders(req),
      timeout: 30000,
    });
    res.status(response.status).json(response.data);
  } catch (error) { proxyError(res, error); }
});

router.get('/download/:reportId', async (req, res) => {
  try {
    const response = await axios.get(
      `${REPORTING_SERVICE_URL}/api/reports/download/${req.params.reportId}`,
      { headers: buildAuthHeaders(req), responseType: 'stream', timeout: 60000 }
    );
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
    res.setHeader('Content-Disposition', response.headers['content-disposition'] || `attachment; filename="report-${req.params.reportId}.pdf"`);
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    response.data.pipe(res);
  } catch (error) { proxyError(res, error); }
});

router.get('/schedule', async (req, res) => {
  try {
    const response = await axios.get(`${REPORTING_SERVICE_URL}/api/reports/schedule`, {
      headers: buildAuthHeaders(req), timeout: 10000,
    });
    res.status(response.status).json(response.data);
  } catch (error) { proxyError(res, error); }
});

router.put('/schedule', async (req, res) => {
  try {
    const response = await axios.put(`${REPORTING_SERVICE_URL}/api/reports/schedule`, req.body, {
      headers: buildAuthHeaders(req), timeout: 10000,
    });
    res.status(response.status).json(response.data);
  } catch (error) { proxyError(res, error); }
});

router.post('/send-now', async (req, res) => {
  try {
    const response = await axios.post(`${REPORTING_SERVICE_URL}/api/reports/send-now`, {}, {
      headers: buildAuthHeaders(req), timeout: 30000,
    });
    res.status(response.status).json(response.data);
  } catch (error) { proxyError(res, error); }
});

router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${REPORTING_SERVICE_URL}/api/reports/health`, { timeout: 5000 });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Reporting service unavailable' });
  }
});

module.exports = router;

