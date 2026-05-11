import { supabase } from '../config/supabase';
import { API_GATEWAY_URL } from '../config/api';

/**
 * Ask the API Gateway (auth-service) to refresh Supabase Auth user_metadata from
 * public.users, then refresh the local session so the JWT matches the database.
 *
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function syncTenantMetadataViaGateway() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error('[tenantSync] getSession error:', sessionError.message);
    return { success: false, error: sessionError.message };
  }
  if (!session?.access_token) {
    console.warn('[tenantSync] No access_token; user not signed in');
    return { success: false, error: 'No active session' };
  }

  const gatewayUrl = typeof API_GATEWAY_URL === 'string' ? API_GATEWAY_URL : String(API_GATEWAY_URL || '');
  const base = gatewayUrl.replace(/\/+$/, '');
  if (!base) {
    console.warn('[tenantSync] API_GATEWAY_URL not configured; skipping server metadata sync');
    return { success: false, error: 'API gateway not configured' };
  }

  try {
    const res = await fetch(`${base}/api/auth/sync-metadata`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (!res.ok) {
      console.error('[tenantSync] Gateway error', res.status, body);
      return {
        success: false,
        error: body.error || body.message || `HTTP ${res.status}`,
      };
    }
    if (!body.success) {
      return { success: false, error: body.error || 'Metadata sync failed' };
    }

    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      console.warn('[tenantSync] refreshSession after sync:', refreshError.message);
    }

    return { success: true };
  } catch (e) {
    console.error('[tenantSync] Network error:', e?.message || e);
    return { success: false, error: e.message || 'Network error' };
  }
}
