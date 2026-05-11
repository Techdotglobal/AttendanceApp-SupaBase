import { supabase } from '../config/supabase';
import { apiUrl } from '../config/api';

/**
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function syncTenantMetadataViaGateway() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error('[web tenantSync] getSession:', sessionError.message);
    return { success: false, error: sessionError.message };
  }
  if (!session?.access_token) {
    return { success: false, error: 'No active session' };
  }

  try {
    const res = await fetch(apiUrl('/api/auth/sync-metadata'), {
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
      console.error('[web tenantSync] gateway', res.status, body);
      return { success: false, error: body.error || `HTTP ${res.status}` };
    }
    if (!body.success) {
      return { success: false, error: body.error || 'Sync failed' };
    }
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      console.warn('[web tenantSync] refreshSession:', refreshError.message);
    }
    return { success: true };
  } catch (e) {
    console.error('[web tenantSync] network', e?.message || e);
    return { success: false, error: e.message || 'Network error' };
  }
}
