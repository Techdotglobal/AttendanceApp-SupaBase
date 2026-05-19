// Storage utilities using Supabase (with AsyncStorage fallback)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';
import { getEmployeeByUsername } from './employees';
import { fetchSessionUserCompanyId, fetchCompanyUserUids, requireValidCompanyId } from '../core/tenant/tenantScope';
import { TENANT_RUNTIME_DIAG, tenantDiagLog } from '../core/debug/tenantRuntimeDiag';

const ATTENDANCE_RECORDS_KEY = '@attendance_records'; // For fallback only

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
    isManual: dbRecord.is_manual || false,
    createdBy: dbRecord.created_by,
    createdAt: dbRecord.created_at,
    updatedAt: dbRecord.updated_at,
    updatedBy: dbRecord.updated_by
  };
};

/**
 * Save attendance record to Supabase
 * @param {Object} attendanceRecord - The attendance record to save
 */
export const saveAttendanceRecord = async (attendanceRecord) => {
  try {
    // Get user UID from current Supabase session
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      console.error('Error getting Supabase session:', authError);
      // Fallback to AsyncStorage
      return await saveAttendanceRecordFallback(attendanceRecord);
    }

    // Get employee data for employee_name
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      console.error('[tenant] saveAttendanceRecord: missing company_id');
      return await saveAttendanceRecordFallback(attendanceRecord);
    }
    const employee = await getEmployeeByUsername(attendanceRecord.username, tenantCid);
    
    const recordData = {
      user_uid: authUser.id,
      company_id: tenantCid,
      username: attendanceRecord.username,
      employee_name: employee?.name || attendanceRecord.employeeName || attendanceRecord.username,
      type: attendanceRecord.type,
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
      // Fallback to AsyncStorage
      return await saveAttendanceRecordFallback(attendanceRecord);
    }

    console.log('✓ Attendance record saved to Supabase:', data.id);
    return convertAttendanceFromDb(data);
  } catch (error) {
    console.error('Error saving attendance record:', error);
    // Fallback to AsyncStorage
    return await saveAttendanceRecordFallback(attendanceRecord);
  }
};

/**
 * Fallback: Save attendance record to AsyncStorage with explicit offline status.
 * These records are offline-queued and must not be treated as live tenant records.
 */
const saveAttendanceRecordFallback = async (attendanceRecord) => {
  try {
    const records = await getAttendanceRecordsFallback();
    const newRecord = {
      id: `offline_${Date.now()}`,
      ...attendanceRecord,
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
    for (const record of queued) {
      try {
        const { error } = await supabase
          .from('attendance_records')
          .insert({
            user_uid: authUser.id,
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
          failed++;
        } else {
          // Remove synced record from remaining list
          const idx = remaining.findIndex((r) => r.id === record.id);
          if (idx !== -1) remaining.splice(idx, 1);
          synced++;
        }
      } catch (insertErr) {
        console.warn('[ATT_SYNC] Insert exception for record', record.id, insertErr?.message);
        failed++;
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
export const getOfflineQueuedRecordsForUser = async (username) => {
  try {
    const raw = await AsyncStorage.getItem(ATTENDANCE_RECORDS_KEY);
    const all = raw ? JSON.parse(raw) : [];
    return all.filter((r) => r._recordStatus === 'queued_offline' && r.username === username);
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

