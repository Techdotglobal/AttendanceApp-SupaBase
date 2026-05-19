/**
 * Checkout Validation Service
 * Validates manual checkout attempts based on location and auto_checkout_enabled setting
 */
import { getOfficeLocation } from './geofenceService';
import { getCurrentLocation } from './geofenceService';
import { isWithin1km, getDistanceInMeters, formatDistance } from '../utils/distance';
import { isAutoCheckoutEnabled } from '../../attendance/services/attendanceConfigService';

/**
 * Validate manual checkout attempt
 * @param {Object} user - User object
 * @param {Object} location - Current location (optional, will fetch if not provided)
 * @returns {Promise<{valid: boolean, error?: string, distance?: number}>}
 */
export const validateCheckoutLocation = async (user, location = null) => {
  try {
    // Only validate for in_office users
    const workMode = user.workMode || user.work_mode;
    if (workMode !== 'in_office') {
      // Remote workers can always checkout
      return { valid: true };
    }

    // Check if auto checkout is enabled
    const autoCheckoutEnabled = await isAutoCheckoutEnabled(true);

    // If auto checkout is enabled, allow checkout from anywhere
    if (autoCheckoutEnabled) {
      return { valid: true };
    }

    // Auto checkout is disabled - validate location
    console.log('[CheckoutValidation] Auto checkout disabled, validating location...');

    // Get current location if not provided
    let currentLocation = location;
    if (!currentLocation) {
      currentLocation = await getCurrentLocation();
    }

    if (!currentLocation || !currentLocation.latitude || !currentLocation.longitude) {
      return {
        valid: false,
        error: 'Unable to get your current location. Please enable location services and try again.',
      };
    }

    // Get office location
    const officeLocation = await getOfficeLocation(user);
    const deptLabel = officeLocation?.department_name || user.department || 'your department';

    if (!officeLocation) {
      console.warn('[CheckoutValidation] No department geofence configured, allowing checkout');
      return { valid: true };
    }

    const radiusM = officeLocation.radius_meters || 1000;
    const distance = getDistanceInMeters(
      currentLocation.latitude,
      currentLocation.longitude,
      officeLocation.latitude,
      officeLocation.longitude
    );

    const within =
      radiusM === 1000
        ? isWithin1km(
            currentLocation.latitude,
            currentLocation.longitude,
            officeLocation.latitude,
            officeLocation.longitude
          )
        : distance <= radiusM;

    if (!within) {
      return {
        valid: false,
        error: `You must be within ${formatDistance(radiusM)} of the ${deptLabel} office to check out. You are currently ${formatDistance(distance)} away.`,
        distance,
      };
    }

    // User is within radius
    return { valid: true };
  } catch (error) {
    console.error('[CheckoutValidation] Error validating checkout location:', error);
    // On error, allow checkout (graceful fallback)
    return {
      valid: true,
      warning: 'Unable to validate location. Checkout allowed.',
    };
  }
};
