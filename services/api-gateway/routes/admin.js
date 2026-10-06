const express = require('express');
const axios = require('axios');
const { invalidateIdentityCache } = require('../lib/authenticate');

const router = express.Router();
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, '');

function requestContext(req) {
  try { return JSON.parse(req.get('x-user-context') || req.get('X-User-Context') || '{}'); } catch (_) { return {}; }
}

function invalidateAfterAdminMutation(req, path) {
  const context = requestContext(req);
  const companyId = context.company_id || context.companyId || null;
  const targetMatch = path.match(/\/users\/([^/]+)/) || path.match(/\/managers\/([^/]+)/) || path.match(/\/employee-sites\/([^/]+)/);
  const targetUid = targetMatch?.[1] || null;
  const companyWide = /^\/api\/admin\/(?:organization-roles|departments|sites|approval-workflows|attendance|settings|permissions|workflows)/.test(path);
  invalidateIdentityCache({ uid: companyWide ? null : targetUid, companyId });
}

const forward = async (req, res, method, path) => {
  try {
    const response = await axios({
      method,
      url: `${AUTH_SERVICE_URL}${path}`,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        Authorization: req.headers.authorization || req.get('Authorization') || '',
      },
      timeout: 15000,
      params: req.query,
    });
    if (method !== 'get' && response.status >= 200 && response.status < 300) {
      invalidateAfterAdminMutation(req, path);
    }
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
router.get('/organization-roles', (req, res) => forward(req, res, 'get', '/api/admin/organization-roles'));
router.post('/organization-roles', (req, res) => forward(req, res, 'post', '/api/admin/organization-roles'));
router.patch('/organization-roles/:id', (req, res) => forward(req, res, 'patch', `/api/admin/organization-roles/${req.params.id}`));
router.delete('/organization-roles/:id', (req, res) => forward(req, res, 'delete', `/api/admin/organization-roles/${req.params.id}`));
router.get('/users/:uid/departments', (req, res) => forward(req, res, 'get', `/api/admin/users/${req.params.uid}/departments`));
router.put('/users/:uid/departments', (req, res) => forward(req, res, 'put', `/api/admin/users/${req.params.uid}/departments`));
router.get('/users/:uid/grants', (req, res) => forward(req, res, 'get', `/api/admin/users/${req.params.uid}/grants`));
router.put('/users/:uid/grants', (req, res) => forward(req, res, 'put', `/api/admin/users/${req.params.uid}/grants`));

router.get('/departments', (req, res) => forward(req, res, 'get', '/api/admin/departments'));
router.get('/departments/overview', (req, res) => forward(req, res, 'get', '/api/admin/departments/overview'));
router.post('/departments', (req, res) => forward(req, res, 'post', '/api/admin/departments'));
router.patch('/departments/:id', (req, res) => forward(req, res, 'patch', `/api/admin/departments/${req.params.id}`));
router.delete('/departments/:id', (req, res) => forward(req, res, 'delete', `/api/admin/departments/${req.params.id}`));

router.get('/sites', (req, res) => forward(req, res, 'get', '/api/admin/sites'));
router.post('/sites', (req, res) => forward(req, res, 'post', '/api/admin/sites'));
router.patch('/sites/:id', (req, res) => forward(req, res, 'patch', `/api/admin/sites/${req.params.id}`));
router.delete('/sites/:id', (req, res) => forward(req, res, 'delete', `/api/admin/sites/${req.params.id}`));

router.post('/employee-sites', (req, res) => forward(req, res, 'post', '/api/admin/employee-sites'));
router.get('/employee-sites', (req, res) => forward(req, res, 'get', '/api/admin/employee-sites'));
router.put('/employee-sites/:employeeUid', (req, res) =>
  forward(req, res, 'put', `/api/admin/employee-sites/${req.params.employeeUid}`)
);
router.delete('/employee-sites/:id', (req, res) =>
  forward(req, res, 'delete', `/api/admin/employee-sites/${req.params.id}`)
);

router.get('/approval-workflows', (req, res) => forward(req, res, 'get', '/api/admin/approval-workflows'));
router.put('/approval-workflows/:requestType', (req, res) =>
  forward(req, res, 'put', `/api/admin/approval-workflows/${req.params.requestType}`)
);
router.get('/approval-workflows/:requestType/audit', (req, res) =>
  forward(req, res, 'get', `/api/admin/approval-workflows/${req.params.requestType}/audit`)
);
router.get('/work-mode-requests', (req, res) => forward(req, res, 'get', '/api/admin/work-mode-requests'));
router.patch('/work-mode-requests/:id', (req, res) =>
  forward(req, res, 'patch', `/api/admin/work-mode-requests/${req.params.id}`)
);

router.get('/attendance', (req, res) => forward(req, res, 'get', '/api/admin/attendance'));
router.get('/attendance/rules', (req, res) => forward(req, res, 'get', '/api/admin/attendance/rules'));
router.post('/attendance/rules', (req, res) => forward(req, res, 'post', '/api/admin/attendance/rules'));
router.patch('/attendance/rules/:id', (req, res) => forward(req, res, 'patch', `/api/admin/attendance/rules/${req.params.id}`));
router.delete('/attendance/rules/:id', (req, res) => forward(req, res, 'delete', `/api/admin/attendance/rules/${req.params.id}`));
router.get('/attendance/holidays', (req, res) => forward(req, res, 'get', '/api/admin/attendance/holidays'));
router.post('/attendance/holidays', (req, res) => forward(req, res, 'post', '/api/admin/attendance/holidays'));
router.patch('/attendance/holidays/:id', (req, res) => forward(req, res, 'patch', `/api/admin/attendance/holidays/${req.params.id}`));
router.delete('/attendance/holidays/:id', (req, res) => forward(req, res, 'delete', `/api/admin/attendance/holidays/${req.params.id}`));
router.get('/attendance/summaries', (req, res) => forward(req, res, 'get', '/api/admin/attendance/summaries'));
router.get('/attendance/absence-outcomes', (req, res) => forward(req, res, 'get', '/api/admin/attendance/absence-outcomes'));
router.get('/attendance/absence-outcomes/:id', (req, res) => forward(req, res, 'get', `/api/admin/attendance/absence-outcomes/${req.params.id}`));
router.post('/attendance/absence-outcomes/:id/reconcile', (req, res) => forward(req, res, 'post', `/api/admin/attendance/absence-outcomes/${req.params.id}/reconcile`));
router.post('/attendance', (req, res) => forward(req, res, 'post', '/api/admin/attendance'));
router.patch('/attendance/:id', (req, res) => forward(req, res, 'patch', `/api/admin/attendance/${req.params.id}`));
router.delete('/attendance/:id', (req, res) => forward(req, res, 'delete', `/api/admin/attendance/${req.params.id}`));
router.get('/leaves', (req, res) => forward(req, res, 'get', '/api/admin/leaves'));
router.post('/leaves', (req, res) => forward(req, res, 'post', '/api/admin/leaves'));
router.patch('/leaves/:id', (req, res) => forward(req, res, 'patch', `/api/admin/leaves/${req.params.id}`));

router.get('/tickets', (req, res) => forward(req, res, 'get', '/api/admin/tickets'));
router.post('/tickets', (req, res) => forward(req, res, 'post', '/api/admin/tickets'));
router.patch('/tickets/:id/assign', (req, res) => forward(req, res, 'patch', `/api/admin/tickets/${req.params.id}/assign`));
router.patch('/tickets/:id/close', (req, res) => forward(req, res, 'patch', `/api/admin/tickets/${req.params.id}/close`));
router.patch('/tickets/:id/reopen', (req, res) => forward(req, res, 'patch', `/api/admin/tickets/${req.params.id}/reopen`));

router.get('/calendar-events', (req, res) => forward(req, res, 'get', '/api/admin/calendar-events'));
router.post('/calendar-events', (req, res) => forward(req, res, 'post', '/api/admin/calendar-events'));
router.patch('/calendar-events/:id', (req, res) => forward(req, res, 'patch', `/api/admin/calendar-events/${req.params.id}`));
router.delete('/calendar-events/:id', (req, res) => forward(req, res, 'delete', `/api/admin/calendar-events/${req.params.id}`));

router.get('/notifications/unread-count', (req, res) => forward(req, res, 'get', '/api/admin/notifications/unread-count'));
router.get('/notifications', (req, res) => forward(req, res, 'get', '/api/admin/notifications'));
router.patch('/notifications/:id/read', (req, res) => forward(req, res, 'patch', `/api/admin/notifications/${req.params.id}/read`));
router.post('/notifications/mark-all-read', (req, res) => forward(req, res, 'post', '/api/admin/notifications/mark-all-read'));
router.delete('/notifications/:id', (req, res) => forward(req, res, 'delete', `/api/admin/notifications/${req.params.id}`));

router.get('/settings', (req, res) => forward(req, res, 'get', '/api/admin/settings'));
router.put('/settings', (req, res) => forward(req, res, 'put', '/api/admin/settings'));

// Payroll V1 — thin forward to auth-service, same pattern as everything above.
router.get('/payroll/dashboard', (req, res) => forward(req, res, 'get', '/api/admin/payroll/dashboard'));
router.get('/payroll/salary-profiles', (req, res) => forward(req, res, 'get', '/api/admin/payroll/salary-profiles'));
router.post('/payroll/salary-profiles', (req, res) => forward(req, res, 'post', '/api/admin/payroll/salary-profiles'));
router.patch('/payroll/salary-profiles/:id', (req, res) =>
  forward(req, res, 'patch', `/api/admin/payroll/salary-profiles/${req.params.id}`)
);
router.get('/payroll/periods', (req, res) => forward(req, res, 'get', '/api/admin/payroll/periods'));
router.post('/payroll/periods', (req, res) => forward(req, res, 'post', '/api/admin/payroll/periods'));
router.get('/payroll/periods/:id', (req, res) => forward(req, res, 'get', `/api/admin/payroll/periods/${req.params.id}`));
router.post('/payroll/periods/:id/calculate', (req, res) =>
  forward(req, res, 'post', `/api/admin/payroll/periods/${req.params.id}/calculate`)
);
router.post('/payroll/periods/:id/recalculate', (req, res) =>
  forward(req, res, 'post', `/api/admin/payroll/periods/${req.params.id}/recalculate`)
);
router.post('/payroll/periods/:id/review', (req, res) =>
  forward(req, res, 'post', `/api/admin/payroll/periods/${req.params.id}/review`)
);
router.post('/payroll/periods/:id/approve', (req, res) =>
  forward(req, res, 'post', `/api/admin/payroll/periods/${req.params.id}/approve`)
);
router.post('/payroll/periods/:id/lock', (req, res) =>
  forward(req, res, 'post', `/api/admin/payroll/periods/${req.params.id}/lock`)
);
router.get('/payroll/periods/:id/records', (req, res) =>
  forward(req, res, 'get', `/api/admin/payroll/periods/${req.params.id}/records`)
);
router.get('/payroll/records/:id', (req, res) => forward(req, res, 'get', `/api/admin/payroll/records/${req.params.id}`));
router.post('/payroll/records/:id/adjustments', (req, res) =>
  forward(req, res, 'post', `/api/admin/payroll/records/${req.params.id}/adjustments`)
);
router.delete('/payroll/adjustments/:kind/:id', (req, res) =>
  forward(req, res, 'delete', `/api/admin/payroll/adjustments/${req.params.kind}/${req.params.id}`)
);
router.get('/payroll/reports/summary/:periodId', (req, res) =>
  forward(req, res, 'get', `/api/admin/payroll/reports/summary/${req.params.periodId}`)
);

module.exports = router;
