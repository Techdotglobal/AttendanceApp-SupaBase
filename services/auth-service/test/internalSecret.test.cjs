const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSecret,
  assertProductionSecret,
  secretsMatch,
} = require('../../../shared/security/internalSecret.cjs');

test('internal secret matching rejects missing, empty, and incorrect values', () => {
  assert.equal(secretsMatch('', ''), false);
  assert.equal(secretsMatch('configured', ''), false);
  assert.equal(secretsMatch('configured', 'wrong'), false);
  assert.equal(secretsMatch(' configured ', 'configured'), true);
});

test('production configuration fails closed when INTERNAL_API_SECRET is missing or empty', () => {
  assert.throws(
    () => assertProductionSecret({ NODE_ENV: 'production' }, 'test-service'),
    /INTERNAL_API_SECRET is required in production/
  );
  assert.throws(
    () => assertProductionSecret({ NODE_ENV: 'production', INTERNAL_API_SECRET: '   ' }, 'test-service'),
    /INTERNAL_API_SECRET is required in production/
  );
});

test('production configuration accepts a non-empty shared secret without exposing it', () => {
  assert.equal(
    assertProductionSecret({ NODE_ENV: 'production', INTERNAL_API_SECRET: 'configured' }, 'test-service'),
    'configured'
  );
  assert.equal(normalizeSecret(undefined), '');
});

test('internal attendance endpoint accepts only the configured secret', () => {
  const previousSecret = process.env.INTERNAL_API_SECRET;
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.INTERNAL_API_SECRET = 'configured';
  try {
    // validSecret reads the live environment so this exercises the route's
    // actual guard without making a network request or touching Supabase.
    process.env.SUPABASE_URL ||= 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
    const { validSecret } = require('../routes/attendanceInternalRoutes');
    const req = (value) => ({
      get(name) {
        if (name.toLowerCase() === 'x-internal-auth') return value;
        return undefined;
      },
    });
    assert.equal(validSecret(req(undefined)), false);
    assert.equal(validSecret(req('')), false);
    assert.equal(validSecret(req('wrong')), false);
    assert.equal(validSecret(req('configured')), true);
  } finally {
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previousSecret;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
  }
});
