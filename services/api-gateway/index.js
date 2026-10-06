try {
  // Optional for local `npm start`; compose/Coolify inject env directly.
  require('dotenv').config();
} catch {
  /* dotenv not installed — rely on process env */
}

const { assertProductionSecret } = require('../../shared/security/internalSecret.cjs');
assertProductionSecret(process.env, 'api-gateway');

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const { probeHttp } = require('./lib/health');
const { attachIdentity, requireIdentity, INTERNAL_API_SECRET } = require('./lib/authenticate');

// Every internal forward carries the shared secret so auth-service / reporting-
// service can distinguish a gateway-vouched X-User-Context from a forged one.
if (INTERNAL_API_SECRET) {
  axios.defaults.headers.common['x-internal-auth'] = INTERNAL_API_SECRET;
}

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const REPORTING_SERVICE_URL = (process.env.REPORTING_SERVICE_URL || 'http://localhost:3002').replace(
  /\/+$/,
  ''
);

// Express JSON responses are UTF-8 by default; keep the charset explicit for
// clients/proxies that otherwise guess a legacy encoding.
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return json(body);
  };
  next();
});

// Middleware
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    '[gateway cors] ALLOWED_ORIGINS is not set — allowing all origins. Set a ' +
      'comma-separated list of your web origins for production.'
  );
}
app.use(
  cors({
    origin(origin, cb) {
      // Non-browser callers (mobile, curl, server-to-server) send no Origin.
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  let bodyLog = req.method !== 'GET' ? req.body : undefined;
  if (bodyLog && typeof bodyLog === 'object' && 'password' in bodyLog) {
    bodyLog = { ...bodyLog, password: '[REDACTED]' };
  }
  console.log(`[${timestamp}] ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: bodyLog,
  });
  next();
});

// Auth: strip client-supplied trust headers, verify the bearer token, and
// re-stamp a trusted identity for internal services. Runs on every route;
// public routes (login, onboarding) simply proceed without an identity.
app.use(attachIdentity);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reports', requireIdentity, reportRoutes);
app.use('/api/admin', requireIdentity, adminRoutes);

// Liveness: process is up (used for basic restarts)
app.get('/health', async (req, res) => {
  const deep = String(req.query.deep || '') === '1';
  const payload = {
    status: 'ok',
    message: 'API Gateway is running',
    timestamp: new Date().toISOString(),
    build: process.env.GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'local-dev',
    authServiceUrl: AUTH_SERVICE_URL,
    reportingServiceUrl: REPORTING_SERVICE_URL,
  };

  if (!deep) {
    return res.status(200).json(payload);
  }

  const [auth, reporting] = await Promise.all([
    probeHttp(`${AUTH_SERVICE_URL}/health`),
    probeHttp(`${REPORTING_SERVICE_URL}/health`),
  ]);

  const ready = auth.ok;
  return res.status(ready ? 200 : 503).json({
    ...payload,
    status: ready ? 'ok' : 'degraded',
    checks: {
      authService: auth,
      // Reporting is soft: gateway can still serve auth/admin if reporting is down.
      reportingService: reporting,
    },
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'API Gateway Service',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      reports: '/api/reports',
      health: '/health',
    },
  });
});

// Start server - listen on all interfaces (0.0.0.0) to allow connections from devices
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ========================================`);
  console.log(`[${timestamp}] API Gateway server starting...`);
  console.log(`[${timestamp}] Server running on http://${HOST}:${PORT}`);
  console.log(`[${timestamp}] Health check: http://localhost:${PORT}/health`);
  console.log(`[${timestamp}] For physical devices: http://<your-computer-ip>:${PORT}`);
  console.log(`[${timestamp}] Auth Service URL: ${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}`);
  console.log(`[${timestamp}] Reporting Service URL: ${process.env.REPORTING_SERVICE_URL || 'http://localhost:3002'}`);
  console.log(`[${timestamp}] ========================================`);
  console.log(`[${timestamp}] API Gateway ready to receive requests`);
});

module.exports = app;

