const express = require('express');
const axios = require('axios');

const router = express.Router();

// Auth service base URL
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Forward login request to auth-service
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] API Gateway: Received login request for:`, req.body.usernameOrEmail || 'unknown');
  
  try {
    console.log(`[${timestamp}] API Gateway: Forwarding to Auth Service at ${AUTH_SERVICE_URL}/api/auth/login`);
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/login`, req.body, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });
    
    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Login forwarding error:`, error.message);
    
    if (error.response) {
      // Auth service responded with error
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      // Request was made but no response received
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      // Error setting up request
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * Forward JWT metadata sync to auth-service
 * POST /api/auth/sync-metadata
 * Authorization: Bearer <access_token>
 */
/**
 * GET /api/auth/onboarding-status
 */
router.get('/onboarding-status', async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    const response = await axios.get(`${AUTH_SERVICE_URL}/api/auth/onboarding-status`, {
      timeout: 10000,
    });
    console.log(`[${timestamp}] API Gateway: onboarding-status -> ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - onboarding-status error:`, error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
  }
});

/**
 * POST /api/auth/onboard-company
 * Optional header: X-Onboarding-Key (required when at least one company exists).
 */
router.post('/onboard-company', async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/onboard-company`, req.body || {}, {
      headers: {
        'Content-Type': 'application/json',
        'X-Onboarding-Key': req.get('x-onboarding-key') || req.get('X-Onboarding-Key') || '',
      },
      timeout: 30000,
    });
    console.log(`[${timestamp}] API Gateway: onboard-company -> ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - onboard-company error:`, error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
  }
});

router.post('/sync-metadata', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] API Gateway: Received sync-metadata request`);

  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/sync-metadata`, req.body || {}, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
      },
      timeout: 10000,
    });

    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - sync-metadata forwarding error:`, error.message);

    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

const forwardWithUserContext = async (req, res, method, path) => {
  const timestamp = new Date().toISOString();
  try {
    const response = await axios({
      method,
      url: `${AUTH_SERVICE_URL}${path}`,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
      },
      timeout: 10000,
      params: req.query,
    });
    console.log(`[${timestamp}] API Gateway: ${method.toUpperCase()} ${path} -> ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - ${method} ${path} error:`, error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
};

router.get('/departments', (req, res) => forwardWithUserContext(req, res, 'get', '/api/auth/departments'));
router.get('/position-suggestions', (req, res) =>
  forwardWithUserContext(req, res, 'get', '/api/auth/position-suggestions')
);

/**
 * Forward username check request to auth-service
 * GET /api/auth/check-username/:username
 */
router.get('/check-username/:username', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  console.log(`[${timestamp}] API Gateway: Received check-username request for: ${username}`);
  
  try {
    console.log(`[${timestamp}] API Gateway: Forwarding to Auth Service at ${AUTH_SERVICE_URL}/api/auth/check-username/${username}`);
    const response = await axios.get(`${AUTH_SERVICE_URL}/api/auth/check-username/${username}`, {
      timeout: 10000,
    });
    
    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Check username forwarding error:`, error.message);
    
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * Forward user creation request to auth-service
 * POST /api/auth/users
 */
router.post('/users', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] API Gateway: Received create user request for:`, req.body.username || 'unknown');
  
  try {
    console.log(`[${timestamp}] API Gateway: Forwarding to Auth Service at ${AUTH_SERVICE_URL}/api/auth/users`);
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/auth/users`, req.body, {
      headers: {
        'Content-Type': 'application/json',
        // Forward caller identity so auth-service can enforce tenant isolation
        // (must include role + company_id of the requester).
        'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
      },
      timeout: 10000,
    });
    
    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Create user forwarding error:`, error.message);
    
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * Forward user deletion request to auth-service
 * DELETE /api/auth/users/:uid
 */
router.delete('/users/:uid', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { uid } = req.params;
  console.log(`[${timestamp}] API Gateway: Received delete user request for uid: ${uid}`);

  try {
    console.log(`[${timestamp}] API Gateway: Forwarding to Auth Service at ${AUTH_SERVICE_URL}/api/auth/users/${uid}`);
    const response = await axios.delete(`${AUTH_SERVICE_URL}/api/auth/users/${uid}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
      },
      data: req.body || {},
      timeout: 10000,
    });

    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Delete user forwarding error:`, error.message);

    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * PATCH /api/auth/users/uid/:uid/role — update role by user id (preferred)
 */
router.patch('/users/uid/:uid/role', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { uid } = req.params;
  console.log(`[${timestamp}] API Gateway: Update role by uid: ${uid}`);
  try {
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/uid/${uid}/role`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Update role by uid error:`, error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({ success: false, error: 'Auth service unavailable' });
    } else {
      res.status(500).json({ success: false, error: error.message || 'Internal server error' });
    }
  }
});

/**
 * Forward user role update request to auth-service
 * PATCH /api/auth/users/:username/role
 */
router.patch('/users/:username/role', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  console.log(`[${timestamp}] API Gateway: Received update role request for: ${username}`);
  
  try {
    console.log(`[${timestamp}] API Gateway: Forwarding to Auth Service at ${AUTH_SERVICE_URL}/api/auth/users/${username}/role`);
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/${username}/role`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    
    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Update role forwarding error:`, error.message);
    
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

/**
 * PATCH /api/auth/users/uid/:uid/username
 */
router.patch('/users/uid/:uid/username', async (req, res) => {
  const { uid } = req.params;
  try {
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/uid/${uid}/username`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) return res.status(503).json({ success: false, error: 'Auth service unavailable' });
    return res.status(500).json({ success: false, error: error.message || 'Proxy error' });
  }
});

/**
 * PATCH /api/auth/users/uid/:uid/email
 */
router.patch('/users/uid/:uid/email', async (req, res) => {
  const { uid } = req.params;
  try {
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/uid/${uid}/email`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) return res.status(503).json({ success: false, error: 'Auth service unavailable' });
    return res.status(500).json({ success: false, error: error.message || 'Proxy error' });
  }
});

/**
 * PATCH /api/auth/users/uid/:uid/password
 */
router.patch('/users/uid/:uid/password', async (req, res) => {
  const { uid } = req.params;
  try {
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/uid/${uid}/password`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) return res.status(503).json({ success: false, error: 'Auth service unavailable' });
    return res.status(500).json({ success: false, error: error.message || 'Proxy error' });
  }
});

/**
 * PATCH /api/auth/users/:username/password
 */
router.patch('/users/:username/password', async (req, res) => {
  const { username } = req.params;
  try {
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/${encodeURIComponent(username)}/password`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) return res.status(503).json({ success: false, error: 'Auth service unavailable' });
    return res.status(500).json({ success: false, error: error.message || 'Proxy error' });
  }
});

/**
 * PATCH /api/auth/users/:username/email
 */
router.patch('/users/:username/email', async (req, res) => {
  const { username } = req.params;
  try {
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/${encodeURIComponent(username)}/email`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) return res.status(error.response.status).json(error.response.data);
    if (error.request) return res.status(503).json({ success: false, error: 'Auth service unavailable' });
    return res.status(500).json({ success: false, error: error.message || 'Proxy error' });
  }
});

/**
 * Forward user info update request to auth-service
 * PATCH /api/auth/users/:username
 */
router.patch('/users/:username', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { username } = req.params;
  console.log(`[${timestamp}] API Gateway: Received update user request for: ${username}`);
  
  try {
    console.log(`[${timestamp}] API Gateway: Forwarding to Auth Service at ${AUTH_SERVICE_URL}/api/auth/users/${username}`);
    const response = await axios.patch(
      `${AUTH_SERVICE_URL}/api/auth/users/${username}`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-context': req.get('x-user-context') || req.get('X-User-Context') || '',
        },
        timeout: 10000,
      }
    );
    
    console.log(`[${timestamp}] API Gateway: Auth Service responded with status ${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[${timestamp}] API Gateway - Update user forwarding error:`, error.message);
    
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(503).json({
        success: false,
        error: 'Auth service unavailable',
        message: 'Unable to connect to authentication service',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
});

module.exports = router;

