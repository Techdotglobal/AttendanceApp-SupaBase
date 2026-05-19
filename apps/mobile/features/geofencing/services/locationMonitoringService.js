/**
 * Location Monitoring Service
 * Monitors user location every 60 seconds and automatically checks out
 * if user leaves the 1km office radius while checked in
 */
import * as Location from 'expo-location';
import { getCurrentLocation } from './geofenceService';
import { getOfficeLocation } from './geofenceService';
import { isWithin1km, getDistanceInMeters, formatDistance } from '../utils/distance';
import { getUserAttendanceRecords, saveAttendanceRecord } from '../../../utils/storage';
import { getCurrentLocationWithAddress } from '../../../utils/location';
import { isAutoCheckoutEnabled } from '../../attendance/services/attendanceConfigService';
import { supabase } from '../../../core/config/supabase';
import * as Notifications from 'expo-notifications';

// Monitoring state
let monitoringInterval = null;
let isMonitoring = false;
let currentUser = null;
let lastKnownLocationState = null; // 'inside' | 'outside' | null
let lastAutoCheckoutTime = null; // Prevent duplicate checkouts

/**
 * Configure notification channel for automatic checkout alerts
 */
const configureNotifications = async () => {
  try {
    // Request notification permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[LocationMonitoring] Notification permissions not granted');
      return false;
    }

    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    return true;
  } catch (error) {
    console.error('[LocationMonitoring] Error configuring notifications:', error);
    return false;
  }
};

/**
 * Send notification to user
 */
const sendNotification = async (title, body) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // Show immediately
    });
  } catch (error) {
    console.error('[LocationMonitoring] Error sending notification:', error);
  }
};

/**
 * Get the last attendance record for a user
 * @param {string} username - Username
 * @returns {Promise<Object|null>} Last attendance record or null
 */
const getLastAttendanceRecord = async (username) => {
  try {
    const records = await getUserAttendanceRecords(username);
    if (records && records.length > 0) {
      // Records are already sorted by timestamp DESC
      return records[0];
    }
    return null;
  } catch (error) {
    console.error('[LocationMonitoring] Error getting last attendance record:', error);
    return null;
  }
};

/**
 * Check if user is currently checked in
 * @param {string} username - Username
 * @returns {Promise<boolean>} True if user is checked in
 */
const isUserCheckedIn = async (username) => {
  try {
    const lastRecord = await getLastAttendanceRecord(username);
    return lastRecord && lastRecord.type === 'checkin';
  } catch (error) {
    console.error('[LocationMonitoring] Error checking if user is checked in:', error);
    return false;
  }
};

/**
 * Send notification to manager about employee auto checkout
 */
const notifyManager = async (employee, distance) => {
  try {
    // Get employee's manager
    let managerQuery = supabase
      .from('users')
      .select('uid, username, name, email')
      .eq('role', 'manager')
      .eq('is_active', true)
      .limit(1);

    if (employee.companyId || employee.company_id) {
      managerQuery = managerQuery.eq('company_id', employee.companyId || employee.company_id);
    }
    if (employee.departmentId || employee.department_id) {
      managerQuery = managerQuery.eq('department_id', employee.departmentId || employee.department_id);
    } else if (employee.department) {
      managerQuery = managerQuery.eq('department', employee.department);
    }

    const { data: managerData, error } = await managerQuery.maybeSingle();

    if (error || !managerData) {
      console.warn('[LocationMonitoring] Could not find manager for department:', employee.department);
      return;
    }

    // Create notification in database
    const { error: notifError } = await supabase.rpc('create_notification', {
      p_recipient_uid: managerData.uid || null,
      p_recipient_username: managerData.username,
      p_title: 'Employee Auto Check-Out',
      p_body: `${employee.name || employee.username} was automatically checked out after leaving the office area (${formatDistance(distance)} away).`,
      p_type: 'attendance',
      p_data: {
        type: 'auto_checkout',
        employee_username: employee.username,
        employee_name: employee.name || employee.username,
        distance: distance,
        timestamp: new Date().toISOString(),
      },
    });

    if (notifError) {
      console.error('[LocationMonitoring] Error creating manager notification:', notifError);
    } else {
      console.log('[LocationMonitoring] Manager notification sent to:', managerData.username);
    }
  } catch (error) {
    console.error('[LocationMonitoring] Error notifying manager:', error);
  }
};

/**
 * Automatically check out user
 * @param {Object} user - User object
 * @param {Object} location - Current location
 * @param {number} distance - Distance from office in meters
 * @returns {Promise<boolean>} True if checkout successful
 */
const performAutomaticCheckout = async (user, location, distance) => {
  try {
    // Prevent duplicate checkouts (within 2 minutes)
    const now = Date.now();
    if (lastAutoCheckoutTime && (now - lastAutoCheckoutTime) < 120000) {
      console.log('[LocationMonitoring] Skipping duplicate auto checkout (recent checkout detected)');
      return false;
    }

    console.log('[LocationMonitoring] Performing automatic checkout:', {
      username: user.username,
      distance: `${distance.toFixed(0)}m`,
    });

    // Get current location with address
    const locationData = location || await getCurrentLocationWithAddress();

    const attendanceRecord = {
      id: Date.now().toString(),
      username: user.username,
      type: 'checkout',
      timestamp: new Date().toISOString(),
      photo: null,
      location: {
        ...locationData,
        distance_from_office: distance,
        checkout_reason: 'AUTO_CHECKOUT_OUTSIDE_RADIUS',
      },
      authMethod: 'automatic_geofence',
      isManual: false,
    };

    // Save checkout record
    const saveResult = await saveAttendanceRecord(attendanceRecord);

    if (saveResult?.success && saveResult.record) {
      lastAutoCheckoutTime = now;
      const result = saveResult.record;

      // Log the event
      console.log('[LocationMonitoring] ✓ Automatic checkout successful:', {
        username: user.username,
        recordId: result.id || attendanceRecord.id,
        synced: saveResult.source === 'supabase',
        distance: `${distance.toFixed(0)}m`,
        timestamp: attendanceRecord.timestamp,
        location: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
        },
      });

      // Notify user
      const distanceFormatted = formatDistance(distance);
      await sendNotification(
        'Automatic Check-Out',
        `You have been automatically checked out because you left the office area. You were ${distanceFormatted} away from the office.`
      );

      // Notify manager
      await notifyManager(user, distance);

      // Update state
      lastKnownLocationState = 'outside';

      return true;
    }

    return false;
  } catch (error) {
    console.error('[LocationMonitoring] Error performing automatic checkout:', error);
    return false;
  }
};

/**
 * Check location and perform automatic checkout if needed
 * @param {Object} user - User object
 * @returns {Promise<{isInside: boolean, distance?: number}>}
 */
const checkLocationAndCheckout = async (user) => {
  try {
    // Only check for in_office users
    const workMode = user.workMode || user.work_mode;
    if (workMode !== 'in_office') {
      // Skip monitoring for non-office workers
      return { isInside: true };
    }

    // Check if user is checked in
    const checkedIn = await isUserCheckedIn(user.username);
    if (!checkedIn) {
      // User is not checked in, reset state
      lastKnownLocationState = null;
      return { isInside: true };
    }

    // Check location permission
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[LocationMonitoring] Location permission revoked');
      await sendNotification(
        'Location Permission Required',
        'Location permission is required for attendance monitoring. Please enable it in settings.'
      );
      return { isInside: null }; // Unknown state
    }

    // Get current location
    const currentLocation = await getCurrentLocation();
    if (!currentLocation || !currentLocation.latitude || !currentLocation.longitude) {
      console.warn('[LocationMonitoring] Unable to get current location');
      return { isInside: null }; // Unknown state
    }

    // Get office location
    const officeLocation = await getOfficeLocation(user);
    if (!officeLocation) {
      // No office location configured, skip check
      console.warn('[LocationMonitoring] No office location configured');
      return { isInside: true }; // Assume inside if no office location
    }

    // Calculate distance
    const distance = getDistanceInMeters(
      currentLocation.latitude,
      currentLocation.longitude,
      officeLocation.latitude,
      officeLocation.longitude
    );

    const radiusM = officeLocation.radius_meters || 1000;
    const isWithinRadius =
      radiusM === 1000
        ? isWithin1km(
            currentLocation.latitude,
            currentLocation.longitude,
            officeLocation.latitude,
            officeLocation.longitude
          )
        : distance <= radiusM;

    // Update state tracking
    const previousState = lastKnownLocationState;
    lastKnownLocationState = isWithinRadius ? 'inside' : 'outside';

    // Only act on state transitions (inside -> outside)
    if (!isWithinRadius && previousState === 'inside') {
      console.log('[LocationMonitoring] User left office radius:', {
        username: user.username,
        distance: `${distance.toFixed(0)}m`,
      });

      // Check if auto checkout is enabled
      const autoCheckoutEnabled = await isAutoCheckoutEnabled(true); // Use cache

      if (autoCheckoutEnabled) {
        // Auto checkout enabled - perform automatic checkout
        const success = await performAutomaticCheckout(user, currentLocation, distance);
        if (success) {
          // Stop monitoring after successful checkout
          console.log('[LocationMonitoring] Auto checkout successful, stopping monitoring');
          stopLocationMonitoring();
          return { isInside: false, distance };
        }
      } else {
        // Auto checkout disabled - just notify user (don't checkout)
        const distanceFormatted = formatDistance(distance);
        await sendNotification(
          'Outside Office Area',
          `You are ${distanceFormatted} away from the office. Manual checkout is blocked until you return within 1km.`
        );
      }
    } else if (isWithinRadius && previousState === 'outside') {
      // User re-entered radius
      console.log('[LocationMonitoring] User re-entered office radius:', user.username);
      await sendNotification(
        'Back in Office Area',
        'You have returned to the office area. You can now check out manually if needed.'
      );
    }

    return {
      isInside: isWithinRadius,
      distance,
    };
  } catch (error) {
    console.error('[LocationMonitoring] Error in location check:', error);
    return { isInside: null };
  }
};

/**
 * Start location monitoring for a user
 * @param {Object} user - User object
 * @returns {Promise<boolean>} True if monitoring started successfully
 */
export const startLocationMonitoring = async (user) => {
  try {
    // Stop any existing monitoring
    if (isMonitoring) {
      stopLocationMonitoring();
    }

    // Configure notifications
    await configureNotifications();

    // Request location permissions
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[LocationMonitoring] Location permission not granted');
      return false;
    }

    currentUser = user;

    // Perform initial check
    await checkLocationAndCheckout(user);
    
    // Only start monitoring if user is still checked in
    const stillCheckedIn = await isUserCheckedIn(user.username);
    if (!stillCheckedIn) {
      console.log('[LocationMonitoring] User not checked in, skipping monitoring start');
      return true;
    }

    // Start periodic monitoring (every 60 seconds)
    monitoringInterval = setInterval(async () => {
      if (!currentUser) {
        return;
      }

      // Check if user is still checked in before monitoring
      const checkedIn = await isUserCheckedIn(currentUser.username);
      if (!checkedIn) {
        console.log('[LocationMonitoring] User checked out, stopping monitoring');
        stopLocationMonitoring();
        return;
      }

      // Check location and handle accordingly
      await checkLocationAndCheckout(currentUser);
    }, 60000); // 60 seconds

    isMonitoring = true;
    console.log('[LocationMonitoring] ✓ Location monitoring started for user:', user.username);

    return true;
  } catch (error) {
    console.error('[LocationMonitoring] Error starting location monitoring:', error);
    return false;
  }
};

/**
 * Stop location monitoring
 */
export const stopLocationMonitoring = () => {
  try {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
    }

    isMonitoring = false;
    currentUser = null;
    lastKnownLocationState = null;
    lastAutoCheckoutTime = null;
    console.log('[LocationMonitoring] ✓ Location monitoring stopped');
  } catch (error) {
    console.error('[LocationMonitoring] Error stopping location monitoring:', error);
  }
};

/**
 * Get current location state (inside/outside radius)
 * @returns {Promise<{isInside: boolean | null, distance?: number}>}
 */
export const getCurrentLocationState = async () => {
  if (!currentUser) {
    return { isInside: null };
  }

  return await checkLocationAndCheckout(currentUser);
};

/**
 * Check if monitoring is active
 * @returns {boolean} True if monitoring is active
 */
export const isLocationMonitoringActive = () => {
  return isMonitoring;
};

/**
 * Get current monitoring user
 * @returns {Object|null} Current user or null
 */
export const getMonitoringUser = () => {
  return currentUser;
};
