/**
 * Geofence Service
 * Handles geofence management, validation, and location monitoring
 */
import * as Location from 'expo-location';
import { supabase } from '../../../core/config/supabase';
import { calculateDistance, isPointInGeofence, isWithin1km, getDistanceInMeters, formatDistance } from '../utils/distance';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  resolveUserDepartmentId,
  canManageDepartmentGeofence,
  canManageDepartmentGeofenceAsync,
  mapGeofenceRowToOfficeLocation,
} from './departmentGeofenceAccess';

const GEOFENCES_STORAGE_KEY = '@geofences';
const ACTIVE_GEOFENCE_KEY = '@active_geofence';

/** True when new department RPCs are not deployed yet — fall back to legacy company office. */
const isMissingGeofenceRpc = (error) => {
  const msg = String(error?.message || error?.code || '').toLowerCase();
  return (
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    error?.code === 'PGRST202'
  );
};

/**
 * Request location permissions
 * @returns {Promise<boolean>} True if permissions granted
 */
export const requestLocationPermissions = async () => {
  try {
    const { status: existingStatus } = await Location.getForegroundPermissionsAsync();

    if (existingStatus === 'granted') {
      return true;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('[GeofenceService] Error requesting location permissions:', error);
    return false;
  }
};

/**
 * Get current location
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number} | null>}
 */
export const getCurrentLocation = async () => {
  try {
    const hasPermission = await requestLocationPermissions();
    if (!hasPermission) {
      console.warn('[GeofenceService] Location permission not granted');
      return null;
    }

    const isEnabled = await Location.hasServicesEnabledAsync();
    if (!isEnabled) {
      console.warn('[GeofenceService] Location services are disabled');
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeout: 10000,
      maximumAge: 60000,
    });

    if (!location || !location.coords) {
      return null;
    }

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
    };
  } catch (error) {
    console.error('[GeofenceService] Error getting location:', error);
    return null;
  }
};

/**
 * Save geofences to AsyncStorage
 * @param {Array} geofences - Array of geofence objects
 * @returns {Promise<boolean>} True if saved successfully
 */
export const saveGeofences = async (geofences) => {
  try {
    if (!Array.isArray(geofences)) {
      throw new Error('Geofences must be an array');
    }

    // Validate geofences
    const validGeofences = geofences.filter((geofence) => {
      return (
        geofence.id &&
        typeof geofence.latitude === 'number' &&
        typeof geofence.longitude === 'number' &&
        typeof geofence.radius === 'number' &&
        geofence.radius > 0
      );
    });

    await AsyncStorage.setItem(GEOFENCES_STORAGE_KEY, JSON.stringify(validGeofences));
    console.log(`[GeofenceService] Saved ${validGeofences.length} geofences`);
    return true;
  } catch (error) {
    console.error('[GeofenceService] Error saving geofences:', error);
    return false;
  }
};

/**
 * Load geofences from AsyncStorage
 * @returns {Promise<Array>} Array of geofence objects
 */
export const loadGeofences = async () => {
  try {
    const data = await AsyncStorage.getItem(GEOFENCES_STORAGE_KEY);
    if (!data) {
      return [];
    }

    const geofences = JSON.parse(data);
    return Array.isArray(geofences) ? geofences : [];
  } catch (error) {
    console.error('[GeofenceService] Error loading geofences:', error);
    return [];
  }
};

/**
 * Add a new geofence
 * @param {Object} geofence - Geofence object with id, name, latitude, longitude, radius
 * @returns {Promise<boolean>} True if added successfully
 */
export const addGeofence = async (geofence) => {
  try {
    const geofences = await loadGeofences();

    // Check if geofence with same ID already exists
    const existingIndex = geofences.findIndex((g) => g.id === geofence.id);
    if (existingIndex >= 0) {
      // Update existing geofence
      geofences[existingIndex] = geofence;
    } else {
      // Add new geofence
      geofences.push(geofence);
    }

    return await saveGeofences(geofences);
  } catch (error) {
    console.error('[GeofenceService] Error adding geofence:', error);
    return false;
  }
};

/**
 * Remove a geofence by ID
 * @param {string} geofenceId - ID of the geofence to remove
 * @returns {Promise<boolean>} True if removed successfully
 */
export const removeGeofence = async (geofenceId) => {
  try {
    const geofences = await loadGeofences();
    const filtered = geofences.filter((g) => g.id !== geofenceId);
    return await saveGeofences(filtered);
  } catch (error) {
    console.error('[GeofenceService] Error removing geofence:', error);
    return false;
  }
};

/**
 * Check if current location is within any geofence
 * @param {number} latitude - Current latitude
 * @param {number} longitude - Current longitude
 * @returns {Promise<{isInside: boolean, geofence: Object | null, distance: number}>}
 */
export const checkGeofenceStatus = async (latitude, longitude) => {
  try {
    const geofences = await loadGeofences();

    if (geofences.length === 0) {
      return {
        isInside: false,
        geofence: null,
        distance: null,
      };
    }

    // Check each geofence
    for (const geofence of geofences) {
      const isInside = isPointInGeofence(
        latitude,
        longitude,
        geofence.latitude,
        geofence.longitude,
        geofence.radius
      );

      if (isInside) {
        const distance = calculateDistance(
          latitude,
          longitude,
          geofence.latitude,
          geofence.longitude,
          'm'
        );

        return {
          isInside: true,
          geofence,
          distance,
        };
      }
    }

    // Not inside any geofence - find closest
    let closest = null;
    let minDistance = Infinity;

    geofences.forEach((geofence) => {
      const distance = calculateDistance(
        latitude,
        longitude,
        geofence.latitude,
        geofence.longitude,
        'm'
      );

      if (distance < minDistance) {
        minDistance = distance;
        closest = geofence;
      }
    });

    return {
      isInside: false,
      geofence: closest,
      distance: minDistance,
    };
  } catch (error) {
    console.error('[GeofenceService] Error checking geofence status:', error);
    return {
      isInside: false,
      geofence: null,
      distance: null,
    };
  }
};

/**
 * Set active geofence (for monitoring)
 * @param {string|null} geofenceId - ID of the geofence to monitor, or null to disable
 * @returns {Promise<boolean>} True if set successfully
 */
export const setActiveGeofence = async (geofenceId) => {
  try {
    if (geofenceId) {
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, geofenceId);
    } else {
      await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
    }
    return true;
  } catch (error) {
    console.error('[GeofenceService] Error setting active geofence:', error);
    return false;
  }
};

/**
 * Get active geofence ID
 * @returns {Promise<string|null>} Active geofence ID or null
 */
export const getActiveGeofence = async () => {
  try {
    const id = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
    return id || null;
  } catch (error) {
    console.error('[GeofenceService] Error getting active geofence:', error);
    return null;
  }
};

/**
 * Validate geofence data
 * @param {Object} geofence - Geofence object to validate
 * @returns {Object} {valid: boolean, errors: Array<string>}
 */
export const validateGeofence = (geofence) => {
  const errors = [];

  if (!geofence.id || typeof geofence.id !== 'string') {
    errors.push('Geofence ID is required');
  }

  if (!geofence.name || typeof geofence.name !== 'string' || geofence.name.trim() === '') {
    errors.push('Geofence name is required');
  }

  if (typeof geofence.latitude !== 'number' || isNaN(geofence.latitude)) {
    errors.push('Valid latitude is required');
  } else if (geofence.latitude < -90 || geofence.latitude > 90) {
    errors.push('Latitude must be between -90 and 90');
  }

  if (typeof geofence.longitude !== 'number' || isNaN(geofence.longitude)) {
    errors.push('Valid longitude is required');
  } else if (geofence.longitude < -180 || geofence.longitude > 180) {
    errors.push('Longitude must be between -180 and 180');
  }

  if (typeof geofence.radius !== 'number' || isNaN(geofence.radius) || geofence.radius <= 0) {
    errors.push('Valid radius (greater than 0) is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Check if user can update geofence for a department.
 * Super admins: any department. Managers: own department only (includes HR managers).
 * @param {Object} user
 * @param {string|null} departmentId - target department; defaults to user's department
 */
export const canUpdateOfficeLocation = (user, departmentId = null) => {
  if (!user) return false;
  const targetId = departmentId || user.departmentId || user.department_id;
  return canManageDepartmentGeofence(user, targetId);
};

/**
 * Fetch department-scoped geofence via RPC.
 * @param {string|null} departmentId
 * @returns {Promise<object|null>}
 */
const getDepartmentGeofence = async (departmentId = null) => {
  try {
    const { data, error } = await supabase.rpc('get_department_geofence', {
      p_department_id: departmentId || null,
    });

    if (error) {
      if (!isMissingGeofenceRpc(error) && __DEV__) {
        console.warn('[GeofenceService] get_department_geofence:', error.message);
      }
      return null;
    }

    if (data && data.length > 0) {
      return mapGeofenceRowToOfficeLocation({ ...data[0], source: 'department' });
    }
    return null;
  } catch (error) {
    console.error('[GeofenceService] getDepartmentGeofence:', error);
    return null;
  }
};

/**
 * Company-wide fallback (legacy company_offices).
 */
const getCompanyOfficeLocation = async () => {
  try {
    const { data, error } = await supabase.rpc('get_office_location');
    if (error || !data?.length) return null;
    return {
      id: data[0].id,
      latitude: data[0].latitude,
      longitude: data[0].longitude,
      radius_meters: data[0].radius_meters,
      updated_by: data[0].updated_by,
      updated_at: data[0].updated_at,
      source: 'company',
    };
  } catch {
    return null;
  }
};

/**
 * Get geofence for attendance validation (department site first, then company office).
 * @param {Object|null} user - When provided, resolves the user's department geofence
 */
export const getOfficeLocation = async (user = null) => {
  try {
    let departmentId = null;
    if (user) {
      departmentId = await resolveUserDepartmentId(user);
    }

    const departmentSite = await getDepartmentGeofence(departmentId);
    if (departmentSite) {
      return departmentSite;
    }

    return await getCompanyOfficeLocation();
  } catch (error) {
    console.error('[GeofenceService] Error getting office location:', error);
    return null;
  }
};

/**
 * Update department geofence (or company office fallback when no department).
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} radius - meters (default 1000)
 * @param {Object} user
 * @param {string|null} departmentId - required for managers; super_admin must pass when editing a dept
 */
export const updateOfficeLocation = async (
  latitude,
  longitude,
  radius = 1000,
  user = null,
  departmentId = null
) => {
  try {
    console.log('[GeofenceService] updateOfficeLocation called:', {
      latitude,
      longitude,
      radius,
      hasUser: !!user,
      userRole: user?.role,
      userDepartment: user?.department,
    });

    // Validate inputs
    if (typeof latitude !== 'number' || isNaN(latitude)) {
      console.error('[GeofenceService] Invalid latitude:', latitude);
      return {
        success: false,
        error: 'Valid latitude is required',
      };
    }

    if (latitude < -90 || latitude > 90) {
      console.error('[GeofenceService] Latitude out of range:', latitude);
      return {
        success: false,
        error: 'Latitude must be between -90 and 90',
      };
    }

    if (typeof longitude !== 'number' || isNaN(longitude)) {
      console.error('[GeofenceService] Invalid longitude:', longitude);
      return {
        success: false,
        error: 'Valid longitude is required',
      };
    }

    if (longitude < -180 || longitude > 180) {
      console.error('[GeofenceService] Longitude out of range:', longitude);
      return {
        success: false,
        error: 'Longitude must be between -180 and 180',
      };
    }

    if (typeof radius !== 'number' || isNaN(radius) || radius <= 0) {
      console.error('[GeofenceService] Invalid radius:', radius);
      return {
        success: false,
        error: 'Valid radius (greater than 0) is required',
      };
    }

    // CRITICAL: Verify auth session before proceeding
    console.log('[GeofenceService] Verifying auth session...');
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[GeofenceService] Session error:', sessionError);
      return {
        success: false,
        error: 'Authentication session error. Please log in again.',
      };
    }

    if (!session || !session.user) {
      console.error('[GeofenceService] No active session found');
      return {
        success: false,
        error: 'No active session. Please log in again.',
      };
    }

    console.log('[GeofenceService] Auth session verified:', {
      userId: session.user.id,
      email: session.user.email,
    });

    // Use session.user directly instead of calling getUser() again
    // This prevents AuthSessionMissingError when session exists but getUser() fails
    const authUser = session.user;

    console.log('[GeofenceService] Auth user retrieved:', {
      id: authUser.id,
      email: authUser.email,
    });

    let dbUser = null;

    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('uid, username, role, department, department_id, company_id')
      .eq('uid', authUser.id)
      .single();

    if (userDataError || !userData) {
      console.error('[GeofenceService] User not found in database:', {
        error: userDataError,
        authUserId: authUser.id,
        searchedUid: authUser.id,
      });
      
      // Try fallback: search by email
      const { data: userByEmail, error: emailError } = await supabase
        .from('users')
        .select('uid, username, role, department, department_id, company_id')
        .eq('email', authUser.email)
        .single();

      if (emailError || !userByEmail) {
        console.error('[GeofenceService] User not found by email either:', {
          email: authUser.email,
          error: emailError,
        });
        return {
          success: false,
          error: 'User not found in database. Please contact administrator.',
        };
      }

      console.log('[GeofenceService] User found by email fallback:', userByEmail);
      dbUser = userByEmail;
    } else {
      dbUser = userData;
    }

    const targetDept =
      departmentId ||
      dbUser.department_id ||
      (await resolveUserDepartmentId(dbUser));

    if (!(await canManageDepartmentGeofenceAsync(dbUser, targetDept))) {
      return {
        success: false,
        error:
          'Insufficient permissions. You can only update the geofence for your own department.',
      };
    }
    const targetDepartmentId = targetDept;

    if (targetDepartmentId) {
      console.log('[GeofenceService] Calling set_department_geofence:', {
        p_department_id: targetDepartmentId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_radius_meters: radius,
      });

      const { error: deptError } = await supabase.rpc('set_department_geofence', {
        p_department_id: targetDepartmentId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_radius_meters: radius,
        p_site_name: 'Office',
      });

      if (deptError) {
        if (isMissingGeofenceRpc(deptError)) {
          console.warn(
            '[GeofenceService] Department geofence RPC not available — using legacy company office save'
          );
        } else if (
          deptError.message?.includes('permission') ||
          deptError.message?.includes('Insufficient')
        ) {
          return {
            success: false,
            error:
              'Insufficient permissions. You can only update the geofence for your own department.',
          };
        } else {
          return {
            success: false,
            error: deptError.message || 'Failed to update department geofence',
          };
        }
      } else {
        const updatedLocation = await getDepartmentGeofence(targetDepartmentId);
        return { success: true, location: updatedLocation };
      }
    }

    if (dbUser?.role === 'manager' && !targetDepartmentId) {
      return {
        success: false,
        error:
          'Your account is not linked to a department. Ask an administrator to set your department before configuring geofencing.',
      };
    }

    if (dbUser?.role !== 'manager' && dbUser?.role !== 'super_admin') {
      return {
        success: false,
        error: 'Insufficient permissions to update office location.',
      };
    }

    console.log('[GeofenceService] Calling set_office_location RPC (company fallback):', {
      p_latitude: latitude,
      p_longitude: longitude,
      p_radius_meters: radius,
    });

    const { error } = await supabase.rpc('set_office_location', {
      p_latitude: latitude,
      p_longitude: longitude,
      p_radius_meters: radius,
    });

    if (error) {
      console.error('[GeofenceService] RPC error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      if (error.message?.includes('permission') || error.message?.includes('Insufficient')) {
        return {
          success: false,
          error: 'Insufficient permissions to update office location.',
        };
      }

      // Check if it's a "User not found" error
      if (error.message?.includes('User not found')) {
        return {
          success: false,
          error: 'User not found in database. Please ensure your account is properly set up.',
        };
      }

      return {
        success: false,
        error: error.message || 'Failed to update office location',
      };
    }

    const updatedLocation = await getCompanyOfficeLocation();
    console.log('[GeofenceService] Updated company location retrieved:', updatedLocation);

    if (!updatedLocation) {
      console.warn('[GeofenceService] Warning: Location update succeeded but could not retrieve updated location');
    }

    return {
      success: true,
      location: updatedLocation,
    };
  } catch (error) {
    console.error('[GeofenceService] Exception in updateOfficeLocation:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return {
      success: false,
      error: error.message || 'Failed to update office location',
    };
  }
};

/**
 * Validate check-in location based on work mode
 * - in_office: Must be within 1km of office location
 * - semi_remote or fully_remote: No location restriction
 * @param {Object} user - User object with workMode/work_mode
 * @param {number} userLat - User's current latitude
 * @param {number} userLon - User's current longitude
 * @returns {Promise<{valid: boolean, error?: string, distance?: number, warning?: string}>}
 */
export const validateCheckInLocation = async (user, userLat, userLon) => {
  try {
    // Validate coordinates
    if (typeof userLat !== 'number' || typeof userLon !== 'number' || isNaN(userLat) || isNaN(userLon)) {
      return {
        valid: false,
        error: 'Invalid location coordinates. Please enable location services.',
      };
    }

    // Get user's work mode
    const workMode = user.workMode || user.work_mode;

    // If work mode is semi_remote or fully_remote, allow check-in regardless of location
    if (workMode === 'semi_remote' || workMode === 'fully_remote') {
      return {
        valid: true,
      };
    }

    if (workMode === 'in_office') {
      const officeLocation = await getOfficeLocation(user);
      const deptLabel =
        officeLocation?.department_name || user.department || 'your department';

      if (!officeLocation) {
        console.warn('[GeofenceService] No geofence for department, allowing check-in');
        return {
          valid: true,
          warning: `No office geofence configured for ${deptLabel}. Check-in allowed.`,
        };
      }

      const radiusM = officeLocation.radius_meters || 1000;
      const distance = getDistanceInMeters(
        userLat,
        userLon,
        officeLocation.latitude,
        officeLocation.longitude
      );

      if (distance > radiusM) {
        return {
          valid: false,
          error: `You must be within ${formatDistance(radiusM)} of the ${deptLabel} office to check in. You are currently ${formatDistance(distance)} away.`,
          distance,
        };
      }

      return { valid: true };
    }

    // Unknown work mode - allow check-in (graceful fallback)
    console.warn(`[GeofenceService] Unknown work mode: ${workMode}, allowing check-in`);
    return {
      valid: true,
      warning: `Unknown work mode (${workMode}). Check-in allowed.`,
    };
  } catch (error) {
    console.error('[GeofenceService] Error validating check-in location:', error);
    // On error, allow check-in (graceful fallback)
    return {
      valid: true,
      warning: 'Unable to validate location. Check-in allowed.',
    };
  }
};
