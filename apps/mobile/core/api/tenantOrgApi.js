import { API_GATEWAY_URL } from '../config/api';
import { buildGatewayAuthHeaders, resolveCurrentRequester } from './gatewayRequest';

function gatewayBase() {
  return typeof API_GATEWAY_URL === 'string'
    ? API_GATEWAY_URL.replace(/\/+$/, '')
    : String(API_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/**
 * @param {object|null} requester - AuthContext user; resolved from session if omitted
 * @param {{ scope?: 'all' | 'manage' }} [options] - `manage` limits managers to their department (HR forms)
 * @returns {Promise<{ success: boolean, data?: Array<{ id: string, name: string }>, error?: string }>}
 */
export async function fetchTenantDepartments(requester = null, options = {}) {
  const ctx = requester || (await resolveCurrentRequester());
  if (!ctx) {
    return { success: false, error: 'You must be signed in to load departments.' };
  }

  const scope = options.scope === 'manage' ? 'manage' : 'all';
  const query = scope === 'manage' ? '?scope=manage' : '';

  try {
    const response = await fetch(`${gatewayBase()}/api/auth/departments${query}`, {
      method: 'GET',
      headers: buildGatewayAuthHeaders(ctx),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to load departments' };
    }
    return { success: true, data: body.data || [] };
  } catch (e) {
    return { success: false, error: e?.message || 'Network error loading departments' };
  }
}

/**
 * @param {object|null} requester
 * @returns {Promise<{ success: boolean, data?: string[], error?: string }>}
 */
export async function fetchTenantPositionSuggestions(requester = null) {
  const ctx = requester || (await resolveCurrentRequester());
  if (!ctx) {
    return { success: false, error: 'You must be signed in to load positions.' };
  }

  try {
    const response = await fetch(`${gatewayBase()}/api/auth/position-suggestions`, {
      method: 'GET',
      headers: buildGatewayAuthHeaders(ctx),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to load position suggestions' };
    }
    return { success: true, data: body.data || [] };
  } catch (e) {
    return { success: false, error: e?.message || 'Network error loading positions' };
  }
}
