/**
 * Gateway authentication — the real public trust boundary.
 *
 * The browser/mobile client sends `Authorization: Bearer <Supabase access token>`.
 * This middleware:
 *   1. UNCONDITIONALLY strips any client-supplied `x-user-context` / `x-internal-auth`
 *      headers so a caller can never inject its own identity.
 *   2. Verifies the bearer token against Supabase Auth.
 *   3. Re-derives the authoritative identity (uid, role, company_id, department,
 *      permissions) from `public.users` / `manager_permissions` using the caller's
 *      own token (RLS applies — a user can only read their own rows).
 *   4. Re-stamps a trusted `x-user-context` JSON + the shared `x-internal-auth`
 *      secret for the internal services.
 *
 * role / company_id / department / permissions are NEVER taken from the client.
 *
 * Rollout: if SUPABASE_URL / SUPABASE_ANON_KEY are not configured on the gateway
 * this middleware logs a CRITICAL warning and passes the request through
 * unchanged (legacy behaviour) so a code-only deploy does not break the admin
 * panel. Configure the env vars to enforce.
 */
const { createClient } = require('@supabase/supabase-js');
const { normalizeSecret, assertProductionSecret } = require('../../../shared/security/internalSecret.cjs');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || ''
).trim();
const INTERNAL_API_SECRET = normalizeSecret(process.env.INTERNAL_API_SECRET);
assertProductionSecret(process.env, 'gateway auth');

const AUTH_ENFORCED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!AUTH_ENFORCED) {
  console.error(
    '\n[gateway auth] ******************************************************************\n' +
      '[gateway auth] CRITICAL: SUPABASE_URL / SUPABASE_ANON_KEY are not set on the\n' +
      '[gateway auth] api-gateway. Requests are forwarded WITHOUT identity verification\n' +
      '[gateway auth] (legacy X-User-Context trust). Set both env vars to enforce auth.\n' +
      '[gateway auth] ******************************************************************\n'
  );
} else if (!INTERNAL_API_SECRET) {
  console.warn(
    '[gateway auth] INTERNAL_API_SECRET is not set — internal services will run in ' +
      'legacy identity mode. Set the same value here and on auth-service to enforce.'
  );
}

const baseClient = AUTH_ENFORCED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

// Small in-memory cache so a burst of requests from one session does not hammer
// Supabase. Keyed by the raw token; short TTL; identity only (no secrets).
// Authorization changes must converge quickly after a grant/department update.
// The backend still re-checks canonical grants; this cache only avoids repeated
// JWT/profile lookups during a short request burst.
const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 500;
const identityCache = new Map();

/**
 * Invalidate only the cached identities affected by an administrative change.
 * Cache entries are token-keyed, so a user/company filter is used rather than
 * clearing the entire gateway cache. This is best-effort; the auth-service
 * remains authoritative on every protected write.
 */
function invalidateIdentityCache({ uid = null, companyId = null } = {}) {
  const targetUid = uid == null ? null : String(uid);
  const targetCompany = companyId == null ? null : String(companyId);
  for (const [token, entry] of identityCache.entries()) {
    const identity = entry?.identity || {};
    if (targetUid && String(identity.uid || '') !== targetUid) continue;
    if (targetCompany && String(identity.company_id || identity.companyId || '') !== targetCompany) continue;
    identityCache.delete(token);
  }
}

function bearerToken(req) {
  const header = req.headers.authorization || req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function stripClientTrustHeaders(req) {
  delete req.headers['x-user-context'];
  delete req.headers['x-internal-auth'];
  // Header names are lower-cased by Node, but be defensive about proxies.
  delete req.headers['X-User-Context'];
  delete req.headers['X-Internal-Auth'];
}

async function deriveIdentity(token) {
  const cached = identityCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  const { data: authData, error: authError } = await baseClient.auth.getUser(token);
  if (authError || !authData?.user?.id) {
    return null;
  }
  const uid = String(authData.user.id);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: row } = await userClient
    .from('users')
    .select('uid, username, role, company_id, department, department_id, organization_role_id, authorization_version, is_active')
    .eq('uid', uid)
    .maybeSingle();

  let identity;
  if (row?.uid && row.is_active !== false) {
    let grants = [];
    const { data: canonicalGrants, error: canonicalError } = await userClient
      .from('permission_grants')
      .select('permission_key, granted, scope_type, department_id')
      .eq('principal_uid', uid)
      .eq('granted', true);
    if (!canonicalError && canonicalGrants?.length) {
      grants = canonicalGrants;
    } else if (row.role === 'manager') {
      const { data: perms } = await userClient
        .from('manager_permissions')
        .select('permission_key, granted')
        .eq('manager_uid', uid);
      grants = (perms || [])
        .filter((p) => p.granted === true)
        .map((p) => ({ permission_key: p.permission_key, granted: true, scope_type: 'DEPARTMENT', department_id: row.department_id || null }));
    }
    const permissions = [...new Set(grants.map((p) => p.permission_key))];
    identity = {
      uid: row.uid,
      username: row.username || undefined,
      role: row.role,
      company_id: row.company_id != null ? String(row.company_id) : null,
      companyId: row.company_id != null ? String(row.company_id) : null,
      department: row.department != null ? String(row.department) : '',
      department_id: row.department_id != null ? String(row.department_id) : null,
      permissions,
      grants,
      organization_role_id: row.organization_role_id || null,
      authorization_version: row.authorization_version || 1,
    };
  } else {
    // No active users row yet (e.g. mid-onboarding) — fall back to token metadata.
    const meta = authData.user.user_metadata || {};
    identity = {
      uid,
      username: meta.username,
      role: meta.role,
      company_id: meta.company_id != null ? String(meta.company_id) : null,
      companyId: meta.company_id != null ? String(meta.company_id) : null,
      department: meta.department != null ? String(meta.department) : '',
      department_id: null,
      permissions: [],
    };
  }

  if (identityCache.size >= CACHE_MAX) identityCache.clear();
  identityCache.set(token, { identity, expiresAt: Date.now() + CACHE_TTL_MS });
  return identity;
}

/**
 * Always strips client trust headers. If a bearer token is present and valid,
 * attaches `req.identity` and re-stamps trusted headers for downstream services.
 * Never rejects on its own — pair with `requireIdentity` on protected routes.
 */
async function attachIdentity(req, res, next) {
  stripClientTrustHeaders(req);

  if (!AUTH_ENFORCED) {
    // Legacy pass-through: restore whatever the client sent so existing
    // deployments keep working until env vars are configured.
    return next();
  }

  const token = bearerToken(req);
  if (!token) return next();

  try {
    const identity = await deriveIdentity(token);
    if (identity?.uid) {
      req.identity = identity;
      req.headers['x-user-context'] = JSON.stringify(identity);
      if (INTERNAL_API_SECRET) {
        req.headers['x-internal-auth'] = INTERNAL_API_SECRET;
      }
    }
  } catch (err) {
    console.error('[gateway auth] identity derivation failed:', err?.message || err);
  }
  next();
}

/** Hard 401 when no verified identity is attached (protected route groups). */
function requireIdentity(req, res, next) {
  if (!AUTH_ENFORCED) return next(); // legacy mode — downstream still guards
  if (!req.identity?.uid) {
    return res
      .status(401)
      .json({ success: false, error: 'Authentication required. Sign in again.' });
  }
  next();
}

module.exports = {
  attachIdentity,
  requireIdentity,
  invalidateIdentityCache,
  AUTH_ENFORCED,
  INTERNAL_API_SECRET,
};
