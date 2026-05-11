// Signup Request Management using Supabase (with AsyncStorage fallback)
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';

const SIGNUP_REQUESTS_KEY = '@signup_requests'; // For fallback only
const SIGNUP_REQUESTS_FILE = 'signup_requests.json'; // For fallback only

/**
 * Convert database signup request format to app format
 * @param {Object} dbRequest - Request from database
 * @returns {Object} Request in app format
 */
const convertSignupRequestFromDb = (dbRequest) => {
  return {
    id: dbRequest.id,
    username: dbRequest.username,
    password: dbRequest.password, // Only available until approval
    name: dbRequest.name,
    email: dbRequest.email,
    role: dbRequest.role,
    status: dbRequest.status,
    requestedAt: dbRequest.requested_at,
    approvedAt: dbRequest.approved_at,
    approvedBy: dbRequest.approved_by,
    rejectionReason: dbRequest.rejection_reason
  };
};

/**
 * Create a new signup request
 * @param {Object} userData - User signup data
 * @returns {Promise<{success: boolean, requestId?: string, error?: string}>}
 */
export const createSignupRequest = async (userData) => {
  try {
    const { username, password, name, email, role = 'employee' } = userData;
    
    // Validate required fields
    if (!username || !password || !name || !email) {
      return { success: false, error: 'All fields are required' };
    }
    
    // Check if username already exists in signup requests
    const existingRequest = await getSignupRequestByUsername(username);
    if (existingRequest && existingRequest.status === 'pending') {
      return { success: false, error: 'Username already has a pending request' };
    }
    
    // Check if username exists in users table
    const { checkUsernameExists } = await import('./auth');
    const usernameExists = await checkUsernameExists(username);
    if (usernameExists) {
      return { success: false, error: 'Username already exists' };
    }
    
    // Create request in Supabase
    const requestData = {
      username,
      password, // Store password temporarily (will be removed after approval)
      name,
      email,
      role,
      status: 'pending',
      requested_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
      rejection_reason: null
    };

    const { data, error } = await supabase
      .from('signup_requests')
      .insert(requestData)
      .select()
      .single();

    if (error) {
      console.error('Error creating signup request in Supabase:', error);
      // Fallback to AsyncStorage
      return await createSignupRequestFallback(userData);
    }

    console.log('✓ Signup request created in Supabase:', data.id);
    return { success: true, requestId: data.id };
  } catch (error) {
    console.error('Error creating signup request:', error);
    // Fallback to AsyncStorage
    return await createSignupRequestFallback(userData);
  }
};

/**
 * Fallback: Create signup request in AsyncStorage
 */
const createSignupRequestFallback = async (userData) => {
  try {
    const { username, password, name, email, role = 'employee' } = userData;
    const request = {
      id: Date.now().toString(),
      username,
      password,
      name,
      email,
      role,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      rejectionReason: null
    };
    
    const requests = await getSignupRequestsFallback();
    requests.push(request);
    await AsyncStorage.setItem(SIGNUP_REQUESTS_KEY, JSON.stringify(requests));
    
    const filePath = `${FileSystem.documentDirectory}${SIGNUP_REQUESTS_FILE}`;
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(requests));
    
    console.log('⚠️ Signup request created in AsyncStorage (fallback):', request.id);
    return { success: true, requestId: request.id };
  } catch (error) {
    console.error('Error creating signup request in AsyncStorage:', error);
    return { success: false, error: error.message || 'Failed to create signup request' };
  }
};

/**
 * Get all signup requests
 * @param {string} status - Filter by status (pending, approved, rejected)
 * @returns {Promise<Array>}
 */
export const getSignupRequests = async (status = null) => {
  try {
    let query = supabase
      .from('signup_requests')
      .select('*')
      .order('requested_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error getting signup requests from Supabase:', error);
      // Fallback to AsyncStorage
      return await getSignupRequestsFallback(status);
    }

    return data.map(convertSignupRequestFromDb);
  } catch (error) {
    console.error('Error getting signup requests:', error);
    // Fallback to AsyncStorage
    return await getSignupRequestsFallback(status);
  }
};

/**
 * Fallback: Get signup requests from AsyncStorage
 */
const getSignupRequestsFallback = async (status = null) => {
  try {
    const stored = await AsyncStorage.getItem(SIGNUP_REQUESTS_KEY);
    let requests = stored ? JSON.parse(stored) : [];
    
    if (requests.length === 0) {
      const filePath = `${FileSystem.documentDirectory}${SIGNUP_REQUESTS_FILE}`;
      const fileExists = await FileSystem.getInfoAsync(filePath);
      if (fileExists.exists) {
        const fileContent = await FileSystem.readAsStringAsync(filePath);
        requests = JSON.parse(fileContent);
      }
    }
    
    if (status) {
      requests = requests.filter(req => req.status === status);
    }
    
    requests.sort((a, b) => new Date(b.requestedAt || b.requested_at) - new Date(a.requestedAt || a.requested_at));
    
    return requests;
  } catch (error) {
    console.error('Error getting signup requests from AsyncStorage:', error);
    return [];
  }
};

/**
 * Get signup request by username
 * @param {string} username
 * @returns {Promise<Object|null>}
 */
export const getSignupRequestByUsername = async (username) => {
  try {
    const { data, error } = await supabase
      .from('signup_requests')
      .select('*')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.error('Error getting signup request from Supabase:', error);
      // Fallback to AsyncStorage
      const requests = await getSignupRequestsFallback();
      return requests.find(req => req.username === username) || null;
    }

    return data ? convertSignupRequestFromDb(data) : null;
  } catch (error) {
    console.error('Error getting signup request:', error);
    // Fallback to AsyncStorage
    const requests = await getSignupRequestsFallback();
    return requests.find(req => req.username === username) || null;
  }
};

/**
 * Approve a signup request
 * @param {string} requestId - Request ID
 * @param {string} approvedBy - Username of approver
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const approveSignupRequest = async (requestId, approvedBy) => {
  try {
    // Get the request first to get password
    const { data: request, error: fetchError } = await supabase
      .from('signup_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) {
      console.error('Error fetching signup request:', fetchError);
      // Fallback to AsyncStorage
      return await approveSignupRequestFallback(requestId, approvedBy);
    }

    if (request.status !== 'pending') {
      return { success: false, error: `Request is already ${request.status}` };
    }

    const { data: approverRow } = await supabase
      .from('users')
      .select('company_id')
      .eq('username', approvedBy)
      .maybeSingle();

    let companyId = approverRow?.company_id;
    if (!companyId) {
      const { data: comp } = await supabase.from('companies').select('id').limit(1).maybeSingle();
      companyId = comp?.id;
    }

    // Create user in Supabase
    const { addUserToFile } = await import('./auth');
    const addResult = await addUserToFile({
      username: request.username,
      password: request.password,
      email: request.email,
      name: request.name,
      role: request.role,
      department: request.department || '',
      position: request.position || '',
      workMode: request.workMode || 'in_office',
      hireDate: request.hireDate || new Date().toISOString().split('T')[0],
      companyId,
    });
    
    if (!addResult.success) {
      return { success: false, error: addResult.error || 'Failed to add user to system' };
    }

    // Update request status and remove password (security)
    const { error: updateError } = await supabase
      .from('signup_requests')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: approvedBy,
        password: null // Remove password after approval
      })
      .eq('id', requestId);

    if (updateError) {
      console.error('Error updating signup request:', updateError);
      return { success: false, error: updateError.message || 'Failed to update request' };
    }

    console.log('✓ Signup request approved in Supabase:', requestId);
    return { success: true };
  } catch (error) {
    console.error('Error approving signup request:', error);
    // Fallback to AsyncStorage
    return await approveSignupRequestFallback(requestId, approvedBy);
  }
};

/**
 * Fallback: Approve signup request in AsyncStorage
 */
const approveSignupRequestFallback = async (requestId, approvedBy) => {
  try {
    const requests = await getSignupRequestsFallback();
    const request = requests.find(req => req.id === requestId);
    
    if (!request) {
      return { success: false, error: 'Signup request not found' };
    }
    
    if (request.status !== 'pending') {
      return { success: false, error: `Request is already ${request.status}` };
    }
    
    request.status = 'approved';
    request.approvedAt = new Date().toISOString();
    request.approvedBy = approvedBy;
    
    const { addUserToFile } = await import('./auth');
    const addResult = await addUserToFile({
      username: request.username,
      password: request.password,
      email: request.email,
      name: request.name,
      role: request.role,
      department: request.department || '',
      position: request.position || '',
      workMode: request.workMode || 'in_office',
      hireDate: request.hireDate || new Date().toISOString().split('T')[0]
    });
    
    if (!addResult.success) {
      return { success: false, error: addResult.error || 'Failed to add user to system' };
    }
    
    delete request.password;
    
    await AsyncStorage.setItem(SIGNUP_REQUESTS_KEY, JSON.stringify(requests));
    const filePath = `${FileSystem.documentDirectory}${SIGNUP_REQUESTS_FILE}`;
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(requests));
    
    console.log('⚠️ Signup request approved in AsyncStorage (fallback):', requestId);
    return { success: true };
  } catch (error) {
    console.error('Error approving signup request in AsyncStorage:', error);
    return { success: false, error: error.message || 'Failed to approve signup request' };
  }
};

/**
 * Reject a signup request
 * @param {string} requestId - Request ID
 * @param {string} rejectedBy - Username of rejector
 * @param {string} reason - Rejection reason
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const rejectSignupRequest = async (requestId, rejectedBy, reason = '') => {
  try {
    // Get the request first
    const { data: request, error: fetchError } = await supabase
      .from('signup_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) {
      console.error('Error fetching signup request:', fetchError);
      // Fallback to AsyncStorage
      return await rejectSignupRequestFallback(requestId, rejectedBy, reason);
    }

    if (request.status !== 'pending') {
      return { success: false, error: `Request is already ${request.status}` };
    }

    // Update request status and remove password
    const { error: updateError } = await supabase
      .from('signup_requests')
      .update({
        status: 'rejected',
        approved_at: new Date().toISOString(),
        approved_by: rejectedBy,
        rejection_reason: reason,
        password: null // Remove password after rejection
      })
      .eq('id', requestId);

    if (updateError) {
      console.error('Error updating signup request:', updateError);
      return { success: false, error: updateError.message || 'Failed to update request' };
    }

    console.log('✓ Signup request rejected in Supabase:', requestId);
    return { success: true };
  } catch (error) {
    console.error('Error rejecting signup request:', error);
    // Fallback to AsyncStorage
    return await rejectSignupRequestFallback(requestId, rejectedBy, reason);
  }
};

/**
 * Fallback: Reject signup request in AsyncStorage
 */
const rejectSignupRequestFallback = async (requestId, rejectedBy, reason = '') => {
  try {
    const requests = await getSignupRequestsFallback();
    const request = requests.find(req => req.id === requestId);
    
    if (!request) {
      return { success: false, error: 'Signup request not found' };
    }
    
    if (request.status !== 'pending') {
      return { success: false, error: `Request is already ${request.status}` };
    }
    
    request.status = 'rejected';
    request.approvedAt = new Date().toISOString();
    request.approvedBy = rejectedBy;
    request.rejectionReason = reason;
    delete request.password;
    
    await AsyncStorage.setItem(SIGNUP_REQUESTS_KEY, JSON.stringify(requests));
    const filePath = `${FileSystem.documentDirectory}${SIGNUP_REQUESTS_FILE}`;
    await FileSystem.writeAsStringAsync(filePath, JSON.stringify(requests));
    
    console.log('⚠️ Signup request rejected in AsyncStorage (fallback):', requestId);
    return { success: true };
  } catch (error) {
    console.error('Error rejecting signup request in AsyncStorage:', error);
    return { success: false, error: error.message || 'Failed to reject signup request' };
  }
};

/**
 * Get pending signup requests count
 * @returns {Promise<number>}
 */
export const getPendingSignupCount = async () => {
  try {
    const pending = await getSignupRequests('pending');
    return pending.length;
  } catch (error) {
    console.error('Error getting pending count:', error);
    return 0;
  }
};


