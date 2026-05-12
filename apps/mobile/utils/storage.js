// Storage utilities using Supabase (with AsyncStorage fallback)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';
import { getEmployeeByUsername } from './employees';
import { fetchSessionUserCompanyId, fetchCompanyUserUids, requireValidCompanyId } from '../core/tenant/tenantScope';

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
    const employee = await getEmployeeByUsername(attendanceRecord.username, tenantCid);
    
    const recordData = {
      user_uid: authUser.id,
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
 * Fallback: Save attendance record to AsyncStorage
 */
const saveAttendanceRecordFallback = async (attendanceRecord) => {
  try {
    const records = await getAttendanceRecordsFallback();
    const newRecord = {
      id: Date.now().toString(),
      ...attendanceRecord,
      timestamp: attendanceRecord.timestamp || new Date().toISOString()
    };
    records.push(newRecord);
    await AsyncStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(records));
    console.log('⚠️ Saved attendance record to AsyncStorage (fallback)');
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
      console.warn('[tenant] getAttendanceRecords: no company_id');
      return await getAttendanceRecordsFallback();
    }
    const tenantUids = await fetchCompanyUserUids(supabase, tenantCid, 'getAttendanceRecords');
    if (tenantUids.length === 0) {
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getAttendanceRecords', { queried_company_id: tenantCid, uid_count: tenantUids.length });
    }

    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .in('user_uid', tenantUids)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error getting attendance records from Supabase:', error);
      return await getAttendanceRecordsFallback();
    }

    return data.map(convertAttendanceFromDb);
  } catch (error) {
    console.error('Error getting attendance records:', error);
    return await getAttendanceRecordsFallback();
  }
};

/**
 * Fallback: Get all attendance records from AsyncStorage
 */
const getAttendanceRecordsFallback = async () => {
  try {
    const recordsJson = await AsyncStorage.getItem(ATTENDANCE_RECORDS_KEY);
    return recordsJson ? JSON.parse(recordsJson) : [];
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
      const allRecords = await getAttendanceRecordsFallback();
      return allRecords.filter(
        (record) => record.username === username || record.userId === username
      );
    }
    const tenantUids = await fetchCompanyUserUids(supabase, tenantCid, 'getUserAttendanceRecords');
    if (tenantUids.length === 0) {
      return [];
    }

    if (__DEV__) {
      console.log('[tenant] getUserAttendanceRecords', { username, queried_company_id: tenantCid });
    }

    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('username', username)
      .in('user_uid', tenantUids)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error getting user attendance records from Supabase:', error);
      const allRecords = await getAttendanceRecordsFallback();
      return allRecords.filter(
        (record) => record.username === username || record.userId === username
      );
    }

    return data.map(convertAttendanceFromDb);
  } catch (error) {
    console.error('Error getting user attendance records:', error);
    const allRecords = await getAttendanceRecordsFallback();
    return allRecords.filter(
      (record) => record.username === username || record.userId === username
    );
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
    const tenantUids = tenantCid ? await fetchCompanyUserUids(supabase, tenantCid, 'updateAttendanceRecord') : [];
    if (tenantCid && tenantUids.length > 0) {
      const { data: existing, error: exErr } = await supabase
        .from('attendance_records')
        .select('user_uid')
        .eq('id', recordId)
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
      .eq('id', recordId);

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
 * Fallback: Update attendance record in AsyncStorage
 */
const updateAttendanceRecordFallback = async (recordId, updates) => {
  try {
    const records = await getAttendanceRecordsFallback();
    const recordIndex = records.findIndex(r => r.id === recordId);
    
    if (recordIndex === -1) {
      return { success: false, error: 'Record not found' };
    }
    
    records[recordIndex] = {
      ...records[recordIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: updates.updatedBy || 'system'
    };
    
    await AsyncStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(records));
    return { success: true };
  } catch (error) {
    console.error('Error updating attendance record in AsyncStorage:', error);
    return { success: false, error: error.message || 'Failed to update record' };
  }
};

/**
 * Delete an attendance record
 * @param {string} recordId - Record ID to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteAttendanceRecord = async (recordId) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    const tenantUids = tenantCid ? await fetchCompanyUserUids(supabase, tenantCid, 'deleteAttendanceRecord') : [];
    if (tenantCid && tenantUids.length > 0) {
      const { data: existing, error: exErr } = await supabase
        .from('attendance_records')
        .select('user_uid')
        .eq('id', recordId)
        .maybeSingle();
      if (exErr || !existing || !tenantUids.includes(existing.user_uid)) {
        console.error('[tenant] deleteAttendanceRecord: record outside tenant or not found');
        return { success: false, error: 'Record not found' };
      }
    }

    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('id', recordId);

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

/**
 * Fallback: Delete attendance record from AsyncStorage
 */
const deleteAttendanceRecordFallback = async (recordId) => {
  try {
    const records = await getAttendanceRecordsFallback();
    const filteredRecords = records.filter(r => r.id !== recordId);
    
    if (filteredRecords.length === records.length) {
      return { success: false, error: 'Record not found' };
    }
    
    await AsyncStorage.setItem(ATTENDANCE_RECORDS_KEY, JSON.stringify(filteredRecords));
    return { success: true };
  } catch (error) {
    console.error('Error deleting attendance record from AsyncStorage:', error);
    return { success: false, error: error.message || 'Failed to delete record' };
  }
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

// Session management using AsyncStorage
const USER_SESSION_KEY = '@user_session';

export const saveUserSession = async (user) => {
  try {
    await AsyncStorage.setItem(USER_SESSION_KEY, JSON.stringify(user));
  } catch (error) {
    console.error('Error saving user session:', error);
  }
};

export const getUserSession = async () => {
  try {
    const sessionData = await AsyncStorage.getItem(USER_SESSION_KEY);
    return sessionData ? JSON.parse(sessionData) : null;
  } catch (error) {
    console.error('Error getting user session:', error);
    return null;
  }
};

export const clearUserSession = async () => {
  try {
    await AsyncStorage.removeItem(USER_SESSION_KEY);
  } catch (error) {
    console.error('Error clearing user session:', error);
  }
};
