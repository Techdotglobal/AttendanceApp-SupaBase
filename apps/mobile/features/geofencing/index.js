/**
 * Geofencing Feature - Public API
 * Export all geofencing-related functionality from this module
 */

// Services
export {
  requestLocationPermissions,
  getCurrentLocation,
  saveGeofences,
  loadGeofences,
  addGeofence,
  removeGeofence,
  checkGeofenceStatus,
  setActiveGeofence,
  getActiveGeofence,
  validateGeofence,
  getOfficeLocation,
  updateOfficeLocation,
  canUpdateOfficeLocation,
  validateCheckInLocation,
} from './services/geofenceService';

export {
  resolveUserDepartmentId,
  canManageDepartmentGeofence,
  listManageableDepartments,
} from './services/departmentGeofenceAccess';

// Location Monitoring
export {
  startLocationMonitoring,
  stopLocationMonitoring,
  isLocationMonitoringActive,
  getMonitoringUser,
  getCurrentLocationState,
} from './services/locationMonitoringService';

// Checkout Validation
export {
  validateCheckoutLocation,
} from './services/checkoutValidationService';

// Hooks
export { useGeofence } from './hooks/useGeofence';
export { useLocationState } from './hooks/useLocationState';

// Utils
export {
  calculateDistance,
  isPointInGeofence,
  isWithin1km,
  getDistanceInMeters,
  formatDistance,
  getClosestGeofence,
} from './utils/distance';

// Screens
export { default as GeoFencingScreen } from './screens/GeoFencingScreen';
