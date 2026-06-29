/**
 * Reports API Gateway Routes
 */
const express = require('express');
const axios = require('axios');

const router = express.Router();
const REPORTING_SERVICE_URL = process.env.REPORTING_SERVICE_URL || 'http://localhost:3002';

function buildAuthHeaders(req) {
  const headers = { 'Content-Type': 'application/json' };
  if (req.headers['x-user-email']) headers['x-user-email'] = req.headers['x-user-email'];
  if (req.headers['x-user-id']) headers['x-user-id'] = req.headers['x-user-id'];
  if (req.headers['x-user-context']) headers['x-user-context'] = req.headers['x-user-context'];
  return headers;
}

async function proxyJson(method, path, req, res, timeout = 120000) {
  try {
    const response = await axios({
      method,
      url: `${REPORTING_SERVICE_URL}${path}`,
      data: req.body,
      headers: buildAuthHeaders(req),
      timeout,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) return res.status(503).json({ success: false, error: 'Reporting service unavailable' });
    res.status(500).json({ success: false, error: 'Request failed' });
  }
}

async function proxyPdf(method, path, req, res, disposition = 'attachment') {
  try {
    const response = await axios({
      method,
      url: `${REPORTING_SERVICE_URL}${path}`,
      headers: buildAuthHeaders(req),
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    const contentType = response.headers['content-type'] || 'application/pdf';

    if (contentType.includes('application/json')) {
      try {
        const errBody = JSON.parse(Buffer.from(response.data).toString('utf8'));
        return res.status(response.status).json(errBody);
      } catch {
        return res.status(500).json({ success: false, error: 'Unable to load report' });
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      response.headers['content-disposition'] || `${disposition}; filename="report.pdf"`
    );
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    res.send(Buffer.from(response.data));
  } catch (error) {
    if (error.response) {
      const ct = error.response.headers['content-type'] || '';
      if (ct.includes('application/json') && error.response.data) {
        try {
          const text = Buffer.isBuffer(error.response.data)
            ? error.response.data.toString('utf8')
            : JSON.stringify(error.response.data);
          return res.status(error.response.status).json(JSON.parse(text));
        } catch {
          return res.status(error.response.status).json({ success: false, error: 'Unable to load report' });
        }
      }
    }
    if (error.request) return res.status(503).json({ success: false, error: 'Reporting service unavailable' });
    res.status(500).json({ success: false, error: 'Request failed' });
  }
}

router.post('/generate-pdf', (req, res) => proxyJson('post', '/api/reports/generate-pdf', req, res));
router.post('/generate-and-email', (req, res) => proxyJson('post', '/api/reports/generate-and-email', req, res));
router.post('/generate', (req, res) => proxyJson('post', '/api/reports/generate', req, res));
router.get('/preview/:reportId', (req, res) => proxyPdf('get', `/api/reports/preview/${req.params.reportId}`, req, res, 'inline'));
router.get('/download/:reportId', (req, res) => proxyPdf('get', `/api/reports/download/${req.params.reportId}`, req, res, 'attachment'));
router.post('/email/:reportId', (req, res) => proxyJson('post', `/api/reports/email/${req.params.reportId}`, req, res));
router.get('/history', (req, res) => proxyJson('get', '/api/reports/history', req, res));
router.get('/latest', (req, res) => proxyJson('get', '/api/reports/latest', req, res));
router.delete('/:reportId', (req, res) => proxyJson('delete', `/api/reports/${req.params.reportId}`, req, res));
router.get('/recipients', (req, res) => proxyJson('get', '/api/reports/recipients', req, res));
router.get('/schedule', (req, res) => proxyJson('get', '/api/reports/schedule', req, res));
router.put('/schedule', (req, res) => proxyJson('put', '/api/reports/schedule', req, res));
router.post('/send-now', (req, res) => proxyJson('post', '/api/reports/send-now', req, res));
router.get('/health', (req, res) => proxyJson('get', '/api/reports/health', req, res));

module.exports = router;
