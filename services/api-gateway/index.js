const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: req.method !== 'GET' ? req.body : undefined
  });
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'API Gateway is running',
    timestamp: new Date().toISOString(),
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

