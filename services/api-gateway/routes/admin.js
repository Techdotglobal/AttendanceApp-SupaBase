const express = require('express');
const axios = require('axios');

const router = express.Router();
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, '');

const forward = async (req, res, method, path) => {
  try {
    const response = await axios({
      method,
      url: `${AUTH_SERVICE_URL}${path}`,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'x-user-context': req.get('x-user-context') || '',
      },
      timeout: 10000,
      params: req.query,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) {
      return res.status(503).json({ success: false, error: 'Auth service unavailable' });
    }
    return res.status(500).json({ success: false, error: error.message || 'Proxy error' });
  }
};

router.get('/dashboard/stats', (req, res) => forward(req, res, 'get', '/api/admin/dashboard/stats'));
router.get('/analytics', (req, res) => forward(req, res, 'get', '/api/admin/analytics'));
router.get('/permissions/meta', (req, res) => forward(req, res, 'get', '/api/admin/permissions/meta'));
router.get('/managers', (req, res) => forward(req, res, 'get', '/api/admin/managers'));
router.get('/managers/:uid/permissions', (req, res) =>
  forward(req, res, 'get', `/api/admin/managers/${req.params.uid}/permissions`)
);
router.put('/managers/:uid/permissions', (req, res) =>
  forward(req, res, 'put', `/api/admin/managers/${req.params.uid}/permissions`)
);
router.get('/audit-logs', (req, res) => forward(req, res, 'get', '/api/admin/audit-logs'));
router.get('/users', (req, res) => forward(req, res, 'get', '/api/admin/users'));
router.get('/users/:uid', (req, res) => forward(req, res, 'get', `/api/admin/users/${req.params.uid}`));
router.patch('/users/:uid', (req, res) => forward(req, res, 'patch', `/api/admin/users/${req.params.uid}`));

router.get('/departments', (req, res) => forward(req, res, 'get', '/api/admin/departments'));
router.get('/departments/overview', (req, res) => forward(req, res, 'get', '/api/admin/departments/overview'));
router.post('/departments', (req, res) => forward(req, res, 'post', '/api/admin/departments'));
router.patch('/departments/:id', (req, res) => forward(req, res, 'patch', `/api/admin/departments/${req.params.id}`));
router.delete('/departments/:id', (req, res) => forward(req, res, 'delete', `/api/admin/departments/${req.params.id}`));

router.get('/sites', (req, res) => forward(req, res, 'get', '/api/admin/sites'));
router.post('/sites', (req, res) => forward(req, res, 'post', '/api/admin/sites'));

router.post('/employee-sites', (req, res) => forward(req, res, 'post', '/api/admin/employee-sites'));

router.get('/attendance', (req, res) => forward(req, res, 'get', '/api/admin/attendance'));
router.get('/leaves', (req, res) => forward(req, res, 'get', '/api/admin/leaves'));
router.patch('/leaves/:id', (req, res) => forward(req, res, 'patch', `/api/admin/leaves/${req.params.id}`));

module.exports = router;
