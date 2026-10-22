// Storage utilities using Supabase (with AsyncStorage fallback)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '../core/config/supabase';
import { getEmployeeByUsername } from './employees';
import { fetchSessionUserCompanyId, fetchCompanyUserUids, requireValidCompanyId } from '../core/tenant/tenantScope';
import { TENANT_RUNTIME_DIAG, tenantDiagLog } from '../core/debug/tenantRuntimeDiag';
import { API_GATEWAY_URL } from '../core/config/api';
import { buildGatewayAuthHeaders } from '../core/api/gatewayRequest';
const {
  deriveSelfServiceAttendanceState,
  normalizeAuthoritativeSelfServiceState,
} = require('../../../shared/attendance/selfServiceState.cjs');
const {
  classifyAttendanceWriteError,
  isDesiredStateSatisfied,
  hasQueueIdentity,
  queueIdentityMatches,
} = require('../../../shared/attendance/mobileQueuePolicy.cjs');

const ATTENDANCE_RECORDS_KEY = '@attendance_records'; // For fallback only

export const getSelfServiceAttendanceState = async (username, requester = null) => {
  const base = typeof API_GATEWAY_URL === 'string'
    ? API_GATEWAY_URL.replace(/\/+$/, '')
    : String(API_GATEWAY_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('API gateway is not configured');
  const headers = await buildGatewayAuthHeaders(requester);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 3000) : null;
  let response;
  try {
    response = await fetch(`${base}/api/auth/attendance/self-state`, {
      headers,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || `Attendance state request failed (${response.status})`);
  }
  return payload.data || null;
};

/**
 * Convert database attendance record format to app format
 * @param {Object} dbRecord - Record from database
 * @returns {Object} Record in app format
 */
const convertAttendanceFromDb = (dbRecord) => {
  return {
    id: dbRecord.id,
    username: dbRecord.username,
    employeeName: dbRecord.employee_name,
    type: dbRecord.type,
    timestamp: dbRecord.timestamp,
    location: dbRecord.location,
    photo: dbRecord.photo,
    authMethod: dbRecord.auth_method,
    checkout_source: dbRecord.checkout_source,
    checkout_reason: dbRecord.checkout_reason,
    auto_checkout_checkin_id: dbRecord.auto_checkout_checkin_id,
    isManual: dbRecord.is_manual || false,
    createdBy: dbRecord.created_by,
    createdAt: dbRecord.created_at,
    updatedAt: dbRecord.updated_at,
    updatedBy: dbRecord.updated_by
  };
};

const attendanceWriteLocks = new Map();

/**
 * Serialize self-service writes per user on this device. This closes the
 * double-tap/race window while preserving the existing direct Supabase write
 * and offline queue contracts.
 */
export const saveAttendanceRecord = (attendanceRecord, requester = null) => {
  const key = String(attendanceRecord?.user_uid || attendanceRecord?.username || 'unknown');
  const existing = attendanceWriteLocks.get(key);
  if (existing) return existing;
  const promise = saveAttendanceRecordInternal(attendanceRecord, requester)
    .finally(() => attendanceWriteLocks.delete(key));
  attendanceWriteLocks.set(key, promise);
  return promise;
};

/**
 * Save attendance record to Supabase
 * @param {Object} attendanceRecord - The attendance record to save
 */
const saveAttendanceRecordInternal = async (attendanceRecord, requester = null) => {
  let authUser = null;
  let tenantCid = null;
  try {
    if (!isSupabaseConfigured()) {
      console.error('[attendance] Supabase not configured — cannot sync check-in/out');
      return {
        success: false,
        source: 'config',
        error:
          'App is not connected to the server. Close and reopen the app after installing the latest update.',
      };
    }

    const normalizedType = String(attendanceRecord.type || '').toLowerCase();
    if (normalizedType !== 'checkin' && normalizedType !== 'checkout') {
      return { success: false, error: 'Invalid attendance type.' };
    }

    // Geofence checkout is an existing automatic path. Keep its local/raw
    // behavior unchanged; authoritative self-service gating below applies only
    // to the normal employee check-in/checkout flow.
    const isGeofenceCheckout = normalizedType === 'checkout'
      && (attendanceRecord.authMethod === 'automatic_geofence'
        || attendanceRecord.auth_method === 'automatic_geofence'
        || attendanceRecord.location?.checkout_reason === 'AUTO_CHECKOUT_OUTSIDE_RADIUS');
    const isNormalSelfService = !attendanceRecord.isManual && !isGeofenceCheckout;

    const existing = await getUserAttendanceRecords(attendanceRecord.username);
    const queued = await getOfflineQueuedRecordsForUser(attendanceRecord.username, requester);
    const localState = deriveSelfServiceAttendanceState([...existing, ...queued]);
    let state = localState;
    let authoritativeState = null;
    if (isNormalSelfService) {
      try {
        authoritativeState = await getSelfServiceAttendanceState(attendanceRecord.username, requester);
        state = normalizeAuthoritativeSelfServiceState(authoritativeState, localState) || localState;
      } catch (stateError) {
        if (__DEV__) console.warn('[attendance] authoritative state unavailable; using local fallback:', stateError?.message || stateError);
      }
    }
    const last = state.lastRecord;
    if (normalizedType === 'checkin' && isNormalSelfService && !state.canCheckIn) {
      return {
        success: false,
        source: state.authoritative ? 'server' : 'local',
        error: state.completed ? 'This workday is already complete.' : 'You are already checked in.',
        authoritativeState: authoritativeState || null,
      };
    }
    if (normalizedType === 'checkout' && isNormalSelfService && !state.canCheckOut) {
      return {
        success: false,
        source: state.authoritative ? 'server' : 'local',
        error: state.completed || last?.type === 'checkout' ? 'This workday is already checked out.' : 'You must check in before checking out.',
        authoritativeState: authoritativeState || null,
      };
    }

    // Prefer local session (no network round-trip). Fall back to getUser() only if needed.
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!sessionError && session?.user) {
        authUser = session.user;
      }
    } catch (sessionErr) {
      console.warn('[attendance] getSession failed, trying getUser:', sessionErr?.message || sessionErr);
    }
    if (!authUser) {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('Error getting Supabase session:', authError);
        return { success: false, source: 'auth', error: 'Authentication is required to save attendance.' };
      }
      authUser = user;
    }

    // Get employee data for employee_name
    tenantCid = await fetchSessionUserCompanyId(supabase);
    // A profile lookup can fail during a genuine outage even when the
    // authenticated session and trusted AuthContext still provide the same
    // tenant. Use that identity-bound context only as a queue/write fallback;
    // an absent requester company remains a hard failure.
    if (!tenantCid && requester?.uid && authUser?.id && String(requester.uid) === String(authUser.id)) {
      tenantCid = requireValidCompanyId(requester.companyId || requester.company_id, 'requester');
    }
    if (!tenantCid) {
      console.error('[tenant] saveAttendanceRecord: missing company_id');
      return { success: false, source: 'tenant', error: 'Tenant context is required to save attendance.' };
    }
    const employee = await getEmployeeByUsername(attendanceRecord.username, tenantCid);
    
    const recordData = {
      user_uid: authUser.id,
      company_id: tenantCid,
      username: attendanceRecord.username,
      employee_name: employee?.name || attendanceRecord.employeeName || attendanceRecord.username,
      type: normalizedType,
      timestamp: attendanceRecord.timestamp || new Date().toISOString(),
      location: attendanceRecord.location || null,
      photo: attendanceRecord.photo || null,
      auth_method: attendanceRecord.authMethod || null,
      is_manual: attendanceRecord.isManual || false,
      created_by: attendanceRecord.createdBy || null
    };

    const { data, error } = await supabase
      .from('attendance_records')
      .insert(recordData)
      .select()
      .single();

    if (error) {
      console.error('Error saving attendance record to Supabase:', error);
      // A committed insert can still lose its response. Re-read the server
      // state before considering an offline retry, so a stale client never
      // flips back to Check In or queues a duplicate checkout.
      const errorClass = classifyAttendanceWriteError(error);
      if (isNormalSelfService) {
        try {
          const refreshed = await getSelfServiceAttendanceState(attendanceRecord.username, requester);
          const refreshedState = normalizeAuthoritativeSelfServiceState(refreshed, localState);
          if (isDesiredStateSatisfied(normalizedType, refreshedState)) {
            return {
              success: true,
              source: 'server-confirmed',
              record: refreshedState.lastRecord,
              authoritativeState: refreshed,
              serverError: error.message,
            };
          }
          if (refreshedState && errorClass === 'terminal') {
            return {
              success: false,
              source: 'server',
              error: normalizedType === 'checkout'
                ? (refreshedState.completed ? 'This workday is already checked out.' : 'You must check in before checking out.')
                : (refreshedState.completed ? 'This workday is already complete.' : 'You are already checked in.'),
              authoritativeState: refreshed,
              serverError: error.message,
            };
          }
        } catch (refreshError) {
          if (__DEV__) console.warn('[attendance] could not refresh state after insert failure:', refreshError?.message || refreshError);
        }
      }
      if (errorClass !== 'network' || !authUser || !tenantCid) {
        return { success: false, source: 'server', error: error.message || 'Attendance was rejected by the server.' };
      }
      const record = await saveAttendanceRecordFallback(attendanceRecord, {
        user_uid: authUser.id,
        company_id: tenantCid,
      });
      return {
        success: true,
        source: 'offline',
        reason: 'network',
        record,
        error: error.message,
      };
    }

    console.log('✓ Attendance record saved to Supabase:', data.id);
    return {
      success: true,
      source: 'supabase',
      record: convertAttendanceFromDb(data),
    };
  } catch (error) {
    console.error('Error saving attendance record:', error);
    const catchType = String(attendanceRecord?.type || '').toLowerCase();
    const catchIsGeofenceCheckout = catchType === 'checkout'
      && (attendanceRecord?.authMethod === 'automatic_geofence'
        || attendanceRecord?.auth_method === 'automatic_geofence'
        || attendanceRecord?.location?.checkout_reason === 'AUTO_CHECKOUT_OUTSIDE_RADIUS');
    const catchIsNormalSelfService = !attendanceRecord?.isManual && !catchIsGeofenceCheckout;
    const catchErrorClass = classifyAttendanceWriteError(error);

    // A thrown insert/fetch exception can represent a committed write whose
    // response was lost. Refresh authoritative state before deciding whether
    // an offline retry is safe, just as the normal Supabase error branch does.
    if (catchIsNormalSelfService) {
      try {
        const refreshed = await getSelfServiceAttendanceState(attendanceRecord.username, requester);
        const refreshedState = normalizeAuthoritativeSelfServiceState(refreshed);
        if (isDesiredStateSatisfied(catchType, refreshedState)) {
          return {
            success: true,
            source: 'server-confirmed',
            record: refreshedState.lastRecord,
            authoritativeState: refreshed,
            serverError: error.message,
          };
        }
        if (refreshedState && catchErrorClass === 'terminal') {
          return {
            success: false,
            source: 'server',
            error: catchType === 'checkout'
              ? (refreshedState.completed ? 'This workday is already checked out.' : 'You must check in before checking out.')
              : (refreshedState.completed ? 'This workday is already complete.' : 'You are already checked in.'),
            authoritativeState: refreshed,
            serverError: error.message,
          };
        }
      } catch (refreshError) {
        if (__DEV__) console.warn('[attendance] could not refresh state after thrown insert failure:', refreshError?.message || refreshError);
      }
    }

    if (catchErrorClass !== 'network' || !authUser || !tenantCid) {
      return { success: false, source: 'server', error: error.message || 'Attendance could not be saved.' };
    }
    const record = await saveAttendanceRecordFallback(attendanceRecord, {
      user_uid: authUser.id,
      company_id: tenantCid,
    });
    return {
      success: true,
      source: 'offline',
      reason: 'network',
      record,
      error: error?.message,
    };
  }
};

/**
 * Fallback: Save attendance record to AsyncStorage with explicit offline status.
 * These records are offline-queued and must not be treated as live tenant records.
 */
const saveAttendanceRecordFallback = async (attendanceRecord, identity = {}) => {
  try {
    if (!identity.user_uid || !identity.company_id) {
      throw new Error('Attendance queue requires authenticated user and company context.');
    }
    const records = await getAttendanceRecordsFallback();
    const newRecord = {
      id: `offline_${Date.now()}`,
      ...attendanceRecord,
      user_uid: identity.user_uid,
      company_id: identity.company_id,
      timestamp: attendanceRecord.timestamp || new Date().toISOString(),
      _recordStatus: 'queued_offline',
    };
    records.push(newRecord);
    await AsyncStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(records));
    console.log('⚠️ Saved attendance record to AsyncStorage as queued_offline (Supabase unavailable)');
    return newRecord;
  } catch (error) {
    console.error('Error saving attendance record to AsyncStorage:', error);
    throw error;
  }
};

/**
 * Get all attendance records from Supabase (tenant-scoped)
 * @param {string|null} companyId - optional; defaults to session user's company
 */
export const getAttendanceRecords = async (companyId = null) => {
  try {
    const tenantCid = requireValidCompanyId(companyId, 'getAttendanceRecords') || (await fetchSessionUserCompanyId(supabase));
    if (!tenantCid) {
      console.warn('[tenant] getAttendanceRecords: no valid company_id — returning empty');
      tenantDiagLog('storage.getAttendanceRecords.path', { branch: 'no_tenant_empty', tenantCid: null });
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getAttendanceRecords', { queried_company_id: tenantCid });
    }

    // DB-6: Direct company_id filter — no UID join needed after migration 20260514210002.
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('company_id', tenantCid)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error getting attendance records from Supabase:', error);
      tenantDiagLog('storage.getAttendanceRecords.path', {
        branch: 'supabase_error_empty',
        tenantCid,
        error: error.message,
      });
      return [];
    }

    tenantDiagLog('storage.getAttendanceRecords.path', {
      branch: 'supabase_success',
      tenantCid,
      recordCount: data?.length ?? 0,
      distinctUsernames: [...new Set((data || []).map((r) => r.username).filter(Boolean))].slice(0, 30),
    });

    return data.map(convertAttendanceFromDb);
  } catch (error) {
    console.error('Error getting attendance records:', error);
    tenantDiagLog('storage.getAttendanceRecords.path', {
      branch: 'exception_empty',
      message: error?.message || String(error),
    });
    return [];
  }
};

/**
 * Fallback: Get all attendance records from AsyncStorage
 */
const getAttendanceRecordsFallback = async () => {
  try {
    const recordsJson = await AsyncStorage.getItem(ATTENDANCE_RECORDS_KEY);
    const parsed = recordsJson ? JSON.parse(recordsJson) : [];
    if (TENANT_RUNTIME_DIAG) {
      tenantDiagLog('storage.getAttendanceRecordsFallback', {
        key: ATTENDANCE_RECORDS_KEY,
        recordCount: parsed.length,
        sampleUsernames: parsed.slice(0, 15).map((r) => r.username || r.userId || null),
      });
    }
    return parsed;
  } catch (error) {
    console.error('Error getting attendance records from AsyncStorage:', error);
    return [];
  }
};

/**
 * Get attendance records for a specific user
 * @param {string} username - Username to filter records
 * @returns {Promise<Array>} Array of attendance records for the user
 */
export const getUserAttendanceRecords = async (username) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      tenantDiagLog('storage.getUserAttendanceRecords.path', { branch: 'no_tenant_empty', username, tenantCid: null });
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getUserAttendanceRecords', { username, queried_company_id: tenantCid });
    }

    // DB-6: Direct company_id + username filter — no UID join after migration 20260514210002.
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('company_id', tenantCid)
      .eq('username', username)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error getting user attendance records from Supabase:', error);
      tenantDiagLog('storage.getUserAttendanceRecords.path', {
        branch: 'supabase_error_empty',
        username,
        tenantCid,
        error: error.message,
      });
      return [];
    }

    tenantDiagLog('storage.getUserAttendanceRecords.path', {
      branch: 'supabase_success',
      username,
      tenantCid,
      recordCount: data?.length ?? 0,
    });

    return data.map(convertAttendanceFromDb);
  } catch (error) {
    console.error('Error getting user attendance records:', error);
    tenantDiagLog('storage.getUserAttendanceRecords.path', {
      branch: 'exception_empty',
      username,
      message: error?.message || String(error),
    });
    return [];
  }
};

/**
 * Update an attendance record
 * @param {string} recordId - Record ID to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateAttendanceRecord = async (recordId, updates) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      return { success: false, error: 'Tenant context missing. Please sign in again.' };
    }
    const tenantUids = tenantCid ? await fetchCompanyUserUids(supabase, tenantCid, 'updateAttendanceRecord') : [];
    if (tenantCid && tenantUids.length > 0) {
      const { data: existing, error: exErr } = await supabase
        .from('attendance_records')
        .select('user_uid')
        .eq('id', recordId)
        .eq('company_id', tenantCid)
        .maybeSingle();
      if (exErr || !existing || !tenantUids.includes(existing.user_uid)) {
        console.error('[tenant] updateAttendanceRecord: record outside tenant or not found');
        return { success: false, error: 'Record not found' };
      }
    }

    const updateData = {
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: updates.updatedBy || updates.updated_by || null
    };

    // Remove app-format fields
    delete updateData.updatedBy;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    const { error } = await supabase
      .from('attendance_records')
      .update(updateData)
      .eq('id', recordId)
      .eq('company_id', tenantCid);

    if (error) {
      console.error('Error updating attendance record in Supabase:', error);
      // Fallback to AsyncStorage
      return await updateAttendanceRecordFallback(recordId, updates);
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating attendance record:', error);
    // Fallback to AsyncStorage
    return await updateAttendanceRecordFallback(recordId, updates);
  }
};

/**
 * Update/delete fallbacks are intentionally non-functional.
 * Supabase is the only live source; silently mutating the offline queue creates split-brain state.
 */
const updateAttendanceRecordFallback = async (_recordId, _updates) => {
  console.error('[storage] updateAttendanceRecord: Supabase unavailable — refusing to mutate offline queue');
  return { success: false, error: 'Server unavailable. Please try again when online.' };
};

/**
 * Delete an attendance record
 * @param {string} recordId - Record ID to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteAttendanceRecord = async (recordId) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      return { success: false, error: 'Tenant context missing. Please sign in again.' };
    }
    const tenantUids = tenantCid ? await fetchCompanyUserUids(supabase, tenantCid, 'deleteAttendanceRecord') : [];
    if (tenantCid && tenantUids.length > 0) {
      const { data: existing, error: exErr } = await supabase
        .from('attendance_records')
        .select('user_uid')
        .eq('id', recordId)
        .eq('company_id', tenantCid)
        .maybeSingle();
      if (exErr || !existing || !tenantUids.includes(existing.user_uid)) {
        console.error('[tenant] deleteAttendanceRecord: record outside tenant or not found');
        return { success: false, error: 'Record not found' };
      }
    }

    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('id', recordId)
      .eq('company_id', tenantCid);

    if (error) {
      console.error('Error deleting attendance record from Supabase:', error);
      // Fallback to AsyncStorage
      return await deleteAttendanceRecordFallback(recordId);
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting attendance record:', error);
    // Fallback to AsyncStorage
    return await deleteAttendanceRecordFallback(recordId);
  }
};

const deleteAttendanceRecordFallback = async (_recordId) => {
  console.error('[storage] deleteAttendanceRecord: Supabase unavailable — refusing to mutate offline queue');
  return { success: false, error: 'Server unavailable. Please try again when online.' };
};

/**
 * Create a manual attendance record (for admins/managers)
 * @param {Object} attendanceData - Attendance data (username, type, timestamp, location, etc.)
 * @param {string} createdBy - Username of admin/manager creating the record
 * @returns {Promise<{success: boolean, recordId?: string, error?: string}>}
 */
export const createManualAttendanceRecord = async (attendanceData, createdBy) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    const employee = await getEmployeeByUsername(attendanceData.username, tenantCid);
    if (!employee) {
      return { success: false, error: 'Employee not found' };
    }

    // Get user UID from current Supabase session (for admin/manager)
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      console.error('Error getting Supabase session:', authError);
      return { success: false, error: 'Unable to verify user session' };
    }

    const recordData = {
      user_uid: employee.uid || employee.id?.replace('emp_', '') || null, // Try to get UID from employee
      company_id: tenantCid,
      username: attendanceData.username,
      employee_name: attendanceData.employeeName || employee.name || attendanceData.username,
      type: attendanceData.type,
      timestamp: attendanceData.timestamp || new Date().toISOString(),
      location: attendanceData.location || null,
      photo: attendanceData.photo || null,
      auth_method: attendanceData.authMethod || 'manual',
      is_manual: true,
      created_by: createdBy
    };

    const { data, error } = await supabase
      .from('attendance_records')
      .insert(recordData)
      .select()
      .single();

    if (error) {
      console.error('Error creating manual attendance record in Supabase:', error);
      return { success: false, error: error.message || 'Failed to create record' };
    }

    console.log('✓ Manual attendance record created in Supabase:', data.id);
    return { success: true, recordId: data.id };
  } catch (error) {
    console.error('Error creating manual attendance record:', error);
    return { success: false, error: error.message || 'Failed to create record' };
  }
};

/**
 * ATT-3: Drain queued_offline attendance records into Supabase.
 * Called on app foreground when a session is active. Stops on first permanent error
 * (bad data) but continues past transient network failures.
 * @param {string|null} companyId - tenant scope for the insert policy
 * @returns {Promise<{synced: number, failed: number}>}
 */
export const syncOfflineAttendanceQueue = async (companyId = null) => {
  let synced = 0;
  let failed = 0;
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return { synced, failed };

    const tenantCid = requireValidCompanyId(companyId, 'syncOfflineAttendanceQueue')
      || (await fetchSessionUserCompanyId(supabase));
    if (!tenantCid) return { synced, failed };

    const raw = await AsyncStorage.getItem(ATTENDANCE_RECORDS_KEY);
    const all = raw ? JSON.parse(raw) : [];
    const queued = all.filter((r) => r._recordStatus === 'queued_offline');
    if (queued.length === 0) return { synced, failed };

    console.log(`[ATT_SYNC] Draining ${queued.length} queued_offline records`);

    const remaining = [...all];
    const requester = { uid: authUser.id, companyId: tenantCid };
    const quarantine = (record, reason) => {
      const index = remaining.findIndex((item) => item.id === record.id);
      if (index !== -1) {
        remaining[index] = {
          ...remaining[index],
          _recordStatus: 'quarantined',
          _queueError: reason,
          _quarantinedAt: new Date().toISOString(),
        };
      }
    };
    for (const record of queued) {
      if (!hasQueueIdentity(record)) {
        quarantine(record, 'missing_queue_identity');
        failed++;
        continue;
      }
      if (!queueIdentityMatches(record, authUser.id, tenantCid)) {
        quarantine(record, 'identity_or_company_mismatch');
        failed++;
        continue;
      }
      try {
        const normalizedType = String(record.type || '').toLowerCase();
        const isGeofenceCheckout = normalizedType === 'checkout'
          && (record.authMethod === 'automatic_geofence'
            || record.auth_method === 'automatic_geofence'
            || record.location?.checkout_reason === 'AUTO_CHECKOUT_OUTSIDE_RADIUS');
        if (!(record.isManual || record.is_manual) && !isGeofenceCheckout) {
          try {
            const state = await getSelfServiceAttendanceState(record.username, requester);
            if (isDesiredStateSatisfied(normalizedType, state)) {
              const idx = remaining.findIndex((item) => item.id === record.id);
              if (idx !== -1) remaining.splice(idx, 1);
              synced++;
              continue;
            }
          } catch (stateError) {
            if (__DEV__) console.warn('[ATT_SYNC] state preflight unavailable:', stateError?.message || stateError);
          }
        }
        const { error } = await supabase
          .from('attendance_records')
          .insert({
            user_uid: record.user_uid,
            company_id: tenantCid,
            username: record.username,
            employee_name: record.employeeName || record.employee_name || record.username,
            type: record.type,
            timestamp: record.timestamp || new Date().toISOString(),
            location: record.location || null,
            photo: record.photo || null,
            auth_method: record.authMethod || record.auth_method || null,
            is_manual: record.isManual || record.is_manual || false,
            created_by: record.createdBy || record.created_by || null,
          });
        if (error) {
          console.warn('[ATT_SYNC] Insert failed for record', record.id, error.message);
          if (normalizedType === 'checkin' || normalizedType === 'checkout') {
            try {
              const refreshed = await getSelfServiceAttendanceState(record.username, requester);
              if (isDesiredStateSatisfied(normalizedType, refreshed)) {
                const idx = remaining.findIndex((item) => item.id === record.id);
                if (idx !== -1) remaining.splice(idx, 1);
                synced++;
                continue;
              }
            } catch (refreshError) {
              if (__DEV__) console.warn('[ATT_SYNC] state refresh unavailable:', refreshError?.message || refreshError);
            }
          }
          failed++;
          if (classifyAttendanceWriteError(error) === 'terminal') {
            quarantine(record, error.message || 'terminal_attendance_error');
          }
        } else {
          // Remove synced record from remaining list
          const idx = remaining.findIndex((r) => r.id === record.id);
          if (idx !== -1) remaining.splice(idx, 1);
          synced++;
        }
      } catch (insertErr) {
        console.warn('[ATT_SYNC] Insert exception for record', record.id, insertErr?.message);
        failed++;
        if (classifyAttendanceWriteError(insertErr) === 'terminal') {
          quarantine(record, insertErr?.message || 'terminal_attendance_exception');
        }
      }
    }

    await AsyncStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(remaining));
    console.log(`[ATT_SYNC] Done: synced=${synced} failed=${failed} remaining=${remaining.length}`);
  } catch (err) {
    console.error('[ATT_SYNC] syncOfflineAttendanceQueue error:', err?.message || err);
  }
  return { synced, failed };
};

/**
 * Get offline-queued attendance records for a specific user.
 * Used by the dashboard to determine check-in/check-out state when Supabase was unreachable.
 */
export const getOfflineQueuedRecordsForUser = async (username, requester = null) => {
  try {
    const raw = await AsyncStorage.getItem(ATTENDANCE_RECORDS_KEY);
    const all = raw ? JSON.parse(raw) : [];
    const userUid = requester?.uid || requester?.user_uid;
    const companyId = requester?.companyId || requester?.company_id;
    if (!userUid || !companyId) return [];
    return all.filter((r) =>
      r._recordStatus === 'queued_offline'
      && r.username === username
      && queueIdentityMatches(r, userUid, companyId)
    );
  } catch {
    return [];
  }
};

/**
 * Clear all attendance records (for testing/admin use)
 */
export const clearAllAttendanceRecords = async () => {
  try {
    // Only clear AsyncStorage fallback data
    await AsyncStorage.removeItem(ATTENDANCE_RECORDS_KEY);
    console.log('⚠️ Cleared AsyncStorage attendance records (Supabase records remain)');
  } catch (error) {
    console.error('Error clearing attendance records:', error);
  }
};

