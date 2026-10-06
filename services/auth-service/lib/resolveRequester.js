/**
 * Resolve the caller's TRUSTED identity for privileged auth-service routes.
 *
 * Trust model (in priority order):
 *   1. Gateway-vouched X-User-Context — the api-gateway verified a Supabase JWT,
 *      derived the identity from public.users, and stamped `x-internal-auth` with
 *      the shared INTERNAL_API_SECRET. When that secret matches we trust the
 *      X-User-Context JSON verbatim (no second Supabase round-trip).
 *   2. Authorization: Bearer <Supabase JWT> — verified here, identity re-derived
 *      from public.users. Used for direct-to-service callers and as a fallback
 *      when a proxy strips custom headers.
 *
 * A raw client-supplied X-User-Context with NO matching internal secret and NO
 * valid bearer token is REJECTED. role / company_id / department / permissions
 * are NEVER taken from an unauthenticated client.
 *
 * Non-production legacy mode: if INTERNAL_API_SECRET is not configured the
 * service logs a loud warning and preserves the previous X-User-Context
 * compatibility. Production startup fails closed until the secret is set.
 */
const crypto = require('crypto');
const { normalizeSecret, assertProductionSecret } = require('../../../shared/security/internalSecret.cjs');

const INTERNAL_API_SECRET = normalizeSecret(process.env.INTERNAL_API_SECRET);
assertProductionSecret(process.env, 'auth-service');
const STRICT_IDENTITY = INTERNAL_API_SECRET.length > 0;

let warnedLegacy = false;
function warnLegacyOnce() {
  if (warnedLegacy || STRICT_IDENTITY) return;
  warnedLegacy = true;
  console.warn(
    '[resolveRequester] INTERNAL_API_SECRET is not set — running in LEGACY identity mode. ' +
      'X-User-Context is accepted without a gateway vouch. Set INTERNAL_API_SECRET on the ' +
      'api-gateway and auth-service to enforce authenticated identity.'
  );
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** True when the request carries the shared gateway secret. */
function isGatewayVouched(req) {
  if (!STRICT_IDENTITY) return false;
  const presented = req.get('x-internal-auth') || req.get('X-Internal-Auth') || '';
  return presented.length > 0 && timingSafeEqual(presented, INTERNAL_API_SECRET);
}

function parseUserContextHeader(req) {
  const raw = req.get('x-user-context') || req.get('X-User-Context');
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || req.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

/** Verify a Supabase JWT and load the authoritative users row. */
async function identityFromToken(token) {
  const { supabase } = require('../config/supabase');
  const { data: userResult, error } = await supabase.auth.getUser(token);
  if (error || !userResult?.user?.id) {
    console.warn('[resolveRequester] JWT invalid:', error?.message || 'no user');
    return null;
  }

  const uid = String(userResult.user.id);
  const { data: row } = await supabase
    .from('users')
    .select('uid, username, role, company_id, department, department_id, organization_role_id, authorization_version, is_active')
    .eq('uid', uid)
    .maybeSingle();

  if (row?.uid && row.is_active !== false) {
    return {
      uid: row.uid,
      role: row.role,
      company_id: row.company_id,
      companyId: row.company_id,
      department: row.department != null ? String(row.department) : '',
      department_id: row.department_id != null ? String(row.department_id) : null,
      organization_role_id: row.organization_role_id || null,
      authorization_version: row.authorization_version || 1,
      username: row.username,
      _source: 'jwt',
    };
  }

  const meta = userResult.user.user_metadata || {};
  return {
    uid,
    role: meta.role,
    company_id: meta.company_id,
    companyId: meta.company_id,
    department: meta.department != null ? String(meta.department) : '',
    username: meta.username,
    _source: 'jwt-metadata',
  };
}

/**
 * @param {import('express').Request} req
 * @returns {Promise<object|null>} trusted requester, or null if unauthenticated
 */
async function resolveRequester(req) {
  warnLegacyOnce();

  // 1. Gateway-vouched context (fast path — JWT already verified upstream).
  if (isGatewayVouched(req)) {
    const fromHeader = parseUserContextHeader(req);
    if (fromHeader?.uid) return { ...fromHeader, _source: 'gateway' };
  }

  // 2. Verify a bearer token directly.
  const token = extractBearerToken(req);
  if (token) {
    return await identityFromToken(token);
  }

  // 3. Legacy mode only: accept a raw header (pre-INTERNAL_API_SECRET deploys).
  if (!STRICT_IDENTITY) {
    const fromHeader = parseUserContextHeader(req);
    if (fromHeader?.uid) return { ...fromHeader, _source: 'legacy-header' };
  }

  return null;
}

module.exports = {
  parseUserContextHeader,
  extractBearerToken,
  resolveRequester,
  isGatewayVouched,
  STRICT_IDENTITY,
};
