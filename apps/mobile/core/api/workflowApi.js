import { API_GATEWAY_URL } from '../config/api';
import { buildGatewayAuthHeaders, resolveCurrentRequester, toRequesterContext } from './gatewayRequest';

function gatewayBase() {
  return typeof API_GATEWAY_URL === 'string'
    ? API_GATEWAY_URL.replace(/\/+$/, '')
    : String(API_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export async function refreshPermissionsFromServer(requester = null) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, permissions: [] };
  try {
    const response = await fetch(`${gatewayBase()}/api/auth/me/permissions`, {
      method: 'GET',
      headers: await buildGatewayAuthHeaders(ctx),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return { success: false, permissions: ctx.permissions || [], grants: ctx.grants || [] };
    }
    return {
      success: true,
      permissions: body.data?.permissions || [],
      grants: body.data?.grants || [],
      role: body.data?.role,
      authorization_version: body.data?.authorization_version,
    };
  } catch {
    return { success: false, permissions: ctx.permissions || [] };
  }
}

export async function submitWorkModeRequest(requester, { requested_work_mode, reason }) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, error: 'Authentication expired. Please sign in again.' };
  const url = `${gatewayBase()}/api/auth/work-mode-requests`;
  const payload = { requested_work_mode, reason };
  try {
    const headers = await buildGatewayAuthHeaders(ctx);
    if (__DEV__) {
      console.log('[workflowApi] POST work-mode-requests', {
        url,
        payload,
        uid: ctx.uid,
        hasAuth: Boolean(headers.Authorization),
        hasUserContext: Boolean(headers['X-User-Context']),
      });
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (__DEV__) {
      console.log('[workflowApi] work-mode-requests response', {
        status: response.status,
        success: body.success,
        error: body.error,
      });
    }
    if (!response.ok || !body.success) {
      const statusError =
        response.status === 401
          ? 'Authentication expired. Please sign in again.'
          : response.status === 403
            ? body.error || 'You do not have permission to submit this request.'
            : response.status === 409
              ? 'A pending request already exists.'
              : response.status === 503
                ? 'Auth service unavailable. Try again shortly.'
                : null;
      return {
        success: false,
        error: body.error || statusError || 'Unable to save request.',
      };
    }
    return { success: true, data: body.data, message: body.message };
  } catch (e) {
    console.error('[workflowApi] work-mode-requests network error:', e?.message);
    return { success: false, error: e?.message || 'Network error. Check your connection and try again.' };
  }
}

export async function fetchMyWorkModeRequests(requester = null) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, data: [] };
  try {
    const response = await fetch(`${gatewayBase()}/api/auth/work-mode-requests/mine`, {
      method: 'GET',
      headers: await buildGatewayAuthHeaders(ctx),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return { success: false, data: [] };
    }
    return { success: true, data: body.data || [] };
  } catch {
    return { success: false, data: [] };
  }
}

export async function processWorkModeRequestApi(requester, id, { status, admin_notes }) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, error: 'Authentication expired. Please sign in again.' };
  try {
    const response = await fetch(`${gatewayBase()}/api/admin/work-mode-requests/${id}`, {
      method: 'PATCH',
      headers: await buildGatewayAuthHeaders(ctx),
      body: JSON.stringify({ status, admin_notes }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return { success: false, error: body.error || 'Failed to process request' };
    }
    return { success: true, data: body.data };
  } catch (e) {
    return { success: false, error: e?.message || 'Network error. Check your connection and try again.' };
  }
}

export async function fetchWorkModeRequestsAdmin(requester = null) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, data: [] };
  try {
    const response = await fetch(`${gatewayBase()}/api/admin/work-mode-requests`, {
      method: 'GET',
      headers: await buildGatewayAuthHeaders(ctx),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      return { success: false, data: [] };
    }
    return { success: true, data: body.data || [] };
  } catch {
    return { success: false, data: [] };
  }
}

export async function fetchLeavesAdmin(requester = null) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, data: [] };
  try {
    const response = await fetch(`${gatewayBase()}/api/admin/leaves`, {
      method: 'GET',
      headers: await buildGatewayAuthHeaders(ctx),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.success ? { success: true, data: body.data || [] } : { success: false, data: [], error: body.error };
  } catch (e) {
    return { success: false, data: [], error: e?.message };
  }
}

export async function createLeaveRequestApi(requester, payload) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, error: 'Authentication expired. Please sign in again.' };
  try {
    const response = await fetch(`${gatewayBase()}/api/admin/leaves`, {
      method: 'POST',
      headers: await buildGatewayAuthHeaders(ctx),
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.success ? { success: true, data: body.data } : { success: false, error: body.error || 'Unable to create leave request.' };
  } catch (e) {
    return { success: false, error: e?.message || 'Network error. Check your connection and try again.' };
  }
}

export async function processLeaveRequestApi(requester, id, { status, admin_notes }) {
  const ctx = toRequesterContext(requester) || (await resolveCurrentRequester());
  if (!ctx?.uid) return { success: false, error: 'Authentication expired. Please sign in again.' };
  try {
    const response = await fetch(`${gatewayBase()}/api/admin/leaves/${id}`, {
      method: 'PATCH',
      headers: await buildGatewayAuthHeaders(ctx),
      body: JSON.stringify({ status, admin_notes }),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.success ? { success: true, data: body.data } : { success: false, error: body.error || 'Failed to process leave request' };
  } catch (e) {
    return { success: false, error: e?.message || 'Network error. Check your connection and try again.' };
  }
}
