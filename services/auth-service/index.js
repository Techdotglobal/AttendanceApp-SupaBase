const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const opsRoutes = require('./routes/opsRoutes');
const payrollRoutes = require('./routes/payroll');
const { checkSupabase } = require('./lib/health');

const app = express();
const PORT = process.env.PORT || 3001;

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
  let bodyLog = req.method !== 'GET' ? req.body : undefined;
  if (bodyLog && typeof bodyLog === 'object' && 'password' in bodyLog) {
    bodyLog = { ...bodyLog, password: '[REDACTED]' };
  }
  console.log(`[${timestamp}] Auth Service: ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: bodyLog,
  });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', opsRoutes);
app.use('/api/admin/payroll', payrollRoutes);

// Health / readiness. Docker Compose probes /health?deep=1.
app.get('/health', async (req, res) => {
  const deep = String(req.query.deep || '') === '1';
  const payload = {
    status: 'ok',
    message: 'Auth Service is running',
    timestamp: new Date().toISOString(),
    build: process.env.GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'local-dev',
  };

  if (!deep) {
    return res.status(200).json(payload);
  }

  const supabase = await checkSupabase();
  const ready = supabase.ok;
  return res.status(ready ? 200 : 503).json({
    ...payload,
    status: ready ? 'ok' : 'degraded',
    checks: { supabase },
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Auth Service',
    version: '1.0.0',
  });
});

// Start server - listen on all interfaces (0.0.0.0) to allow connections from devices
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ========================================`);
  console.log(`[${timestamp}] Auth Service starting...`);
  console.log(`[${timestamp}] Server running on http://${HOST}:${PORT}`);
  console.log(`[${timestamp}] Health check: http://localhost:${PORT}/health`);
  console.log(`[${timestamp}] Supabase URL: ${process.env.SUPABASE_URL || 'NOT SET'}`);
  console.log(`[${timestamp}] ========================================`);
  console.log(`[${timestamp}] Auth Service ready to receive requests`);
});

module.exports = app;

