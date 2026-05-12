// Supabase Configuration
// This is a trusted backend service. Onboarding and other privileged
// operations REQUIRE a Supabase client built with the service role key so
// inserts/updates bypass Row Level Security. Using an anon key here causes
// errors like: "new row violates row-level security policy".
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('✗ Missing Supabase environment variables');
  console.error('Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env');
  console.error('See services/auth-service/README.md for setup instructions.');
  throw new Error('Supabase configuration missing');
}

/**
 * Decode the `payload` segment of a JWT without verifying its signature
 * (we only need the `role` claim for a startup sanity check).
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

const tokenPayload = decodeJwtPayload(supabaseServiceKey);
const tokenRole = tokenPayload && typeof tokenPayload.role === 'string' ? tokenPayload.role : null;
const tokenRef = tokenPayload && typeof tokenPayload.ref === 'string' ? tokenPayload.ref : null;
const isServiceRole = tokenRole === 'service_role';

if (!tokenPayload) {
  console.warn(
    '⚠ SUPABASE_SERVICE_ROLE_KEY does not look like a JWT. Onboarding will likely fail with RLS errors.'
  );
} else if (!isServiceRole) {
  // Loud, actionable error. We do NOT throw here so other (read-only) routes
  // that do not require service role can still function, but every privileged
  // route below should call `assertServiceRoleClient()` and fail with a 503
  // before attempting writes.
  console.error(
    `✗ SUPABASE_SERVICE_ROLE_KEY is configured with role="${tokenRole}", expected role="service_role".`
  );
  console.error(
    '  → Privileged operations (onboarding, admin creates) will fail with RLS errors until this is fixed.'
  );
  console.error('  → In Supabase: Settings → API → Project API keys → "service_role" (not "anon").');
} else {
  console.log('✓ Supabase service-role JWT detected (role=service_role)', tokenRef ? { ref: tokenRef } : {});
}

// Build the service-role client. We pin the auth options so this client is
// strictly server-side, and explicitly set Authorization + apikey headers so
// any custom proxy/transport in front of Supabase cannot accidentally fall
// back to the anon key.
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'X-Client-Info': 'auth-service/service-role',
    },
  },
});

console.log('✓ Supabase client initialized', {
  url: supabaseUrl,
  service_role_active: isServiceRole,
  token_role: tokenRole || 'unknown',
});

/**
 * Throw a structured error if the Supabase client at runtime is not actually
 * using a service-role key. Call this at the top of privileged routes (e.g.
 * onboarding) so the caller gets a clear 503 instead of a confusing RLS error.
 *
 * @returns {void}
 */
function assertServiceRoleClient() {
  if (isServiceRole) return;
  const err = new Error(
    `Auth service is not configured with a service-role key (role="${
      tokenRole || 'unknown'
    }"). Set SUPABASE_SERVICE_ROLE_KEY to the project's service_role JWT.`
  );
  err.statusCode = 503;
  err.code = 'SERVICE_ROLE_KEY_MISCONFIGURED';
  throw err;
}

module.exports = {
  supabase,
  supabaseUrl,
  initialized: true,
  isServiceRole,
  tokenRole,
  assertServiceRoleClient,
};
