/**
 * Reporting Service
 * Generates and emails attendance, leave, and ticket reports
 */
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { assertProductionSecret } = require('../../shared/security/internalSecret.cjs');
assertProductionSecret(process.env, 'reporting-service');

const reportRoutes = require('./routes/reports');
const { startMonthlyReportJob } = require('./jobs/monthlyReportJob');
const { startAttendanceFinalizationJob } = require('./jobs/attendanceFinalizationJob');
const { cleanupExpiredReports } = require('./services/reportStorage');
const { deletePDFFile } = require('./services/pdfGenerator');
const {
  checkSupabase,
  checkDataDirWritable,
  checkSmtpConfig,
} = require('./lib/health');

const app = express();
const PORT = process.env.PORT || 3002;

app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return json(body);
  };
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Reporting Service: ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: req.method !== 'GET' ? req.body : undefined
  });
  next();
});

// Routes
app.use('/api/reports', reportRoutes);

// Health / readiness. Docker Compose probes /health?deep=1.
app.get('/health', async (req, res) => {
  const deep = String(req.query.deep || '') === '1';
  const payload = {
    status: 'ok',
    message: 'Reporting Service is running',
    timestamp: new Date().toISOString(),
    build: process.env.GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'local-dev',
  };

  if (!deep) {
    return res.status(200).json(payload);
  }

  const [supabase, filesystem, smtp] = await Promise.all([
    checkSupabase(),
    Promise.resolve(checkDataDirWritable()),
    Promise.resolve(checkSmtpConfig()),
  ]);

  const ready = supabase.ok && filesystem.ok;
  return res.status(ready ? 200 : 503).json({
    ...payload,
    status: ready ? 'ok' : 'degraded',
    checks: { supabase, filesystem, smtp },
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Reporting Service',
    version: '1.0.0',
    endpoints: {
      generatePdf: 'POST /api/reports/generate-pdf',
      generateAndEmail: 'POST /api/reports/generate-and-email',
      preview: 'GET /api/reports/preview/:reportId',
      download: 'GET /api/reports/download/:reportId',
      history: 'GET /api/reports/history',
      latest: 'GET /api/reports/latest',
      health: '/health',
    },
  });
});

// Start server - listen on all interfaces (0.0.0.0) to allow connections from devices
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ========================================`);
  console.log(`[${timestamp}] Reporting Service starting...`);
  console.log(`[${timestamp}] Server running on http://${HOST}:${PORT}`);
  console.log(`[${timestamp}] Health check: http://localhost:${PORT}/health`);
  console.log(`[${timestamp}] Supabase URL: ${process.env.SUPABASE_URL || 'NOT SET'}`);
  console.log(`[${timestamp}] ========================================`);
  console.log(`[${timestamp}] Reporting Service ready to receive requests`);
  
  // Start monthly report cron job
  startMonthlyReportJob();
  // Reuse this service's scheduler; the auth service remains the sole
  // authority for attendance calculations and writes.
  startAttendanceFinalizationJob();
  
  // Start cleanup job for expired reports (runs every 5 minutes)
  setInterval(() => {
    cleanupExpiredReports(deletePDFFile);
  }, 5 * 60 * 1000); // 5 minutes
  
  // Run initial cleanup
  cleanupExpiredReports(deletePDFFile);
});

module.exports = app;

