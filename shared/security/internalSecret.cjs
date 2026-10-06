const crypto = require('crypto');

function normalizeSecret(value) {
  return String(value == null ? '' : value).trim();
}

function assertProductionSecret(env = process.env, serviceName = 'service') {
  const environment = String(env?.NODE_ENV || '').trim().toLowerCase();
  const secret = normalizeSecret(env?.INTERNAL_API_SECRET);
  if (environment === 'production' && !secret) {
    throw new Error(`[${serviceName}] INTERNAL_API_SECRET is required in production`);
  }
  return secret;
}

function secretsMatch(configured, presented) {
  const expected = Buffer.from(normalizeSecret(configured));
  const actual = Buffer.from(normalizeSecret(presented));
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { normalizeSecret, assertProductionSecret, secretsMatch };
