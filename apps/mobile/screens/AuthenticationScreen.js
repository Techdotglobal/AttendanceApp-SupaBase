import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { validateCheckInLocation } from '../features/geofencing';
import { isLocationRequiredForCheckIn } from '../features/geofencing/utils/workModeRules';
import { getUserAttendanceRecords, getOfflineQueuedRecordsForUser, getSelfServiceAttendanceState, saveAttendanceRecord } from '../utils/storage';
const { normalizeAuthoritativeSelfServiceState } = require('../../../shared/attendance/selfServiceState.cjs');
const { deriveSelfServiceAttendanceState } = require('../../../shared/attendance/selfServiceState.cjs');
import {
  verifyFace,
  checkFaceRecognitionAvailability,
} from '../utils/faceVerification';
import {
  authenticateWithBiometric,
  checkBiometricAvailability,
  getBiometricTypeName,
} from '../utils/biometricAuth';
import {
  formatAddressForDisplay,
  hasValidCoordinates,
  acquireLocationProgressive,
} from '../utils/location';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';

export default function AuthenticationScreen({ navigation, route }) {
  const { type, user: routeUser, authMethod = 'face' } = route.params;
  const { user: authUser } = useAuth();
  const user = authUser
    ? {
        ...(routeUser || {}),
        ...authUser,
        departmentId:
          authUser.departmentId ??
          authUser.department_id ??
          routeUser?.departmentId ??
          routeUser?.department_id,
        department:
          authUser.department ?? routeUser?.department,
        workMode: authUser.workMode ?? authUser.work_mode ?? routeUser?.workMode ?? routeUser?.work_mode,
        work_mode: authUser.work_mode ?? authUser.workMode ?? routeUser?.work_mode ?? routeUser?.workMode,
      }
    : routeUser;
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState('');
  const [faceIDAvailable, setFaceIDAvailable] = useState(false);

  /** Always holds the freshest progressive fix for geofence / save (survives stale closures). */
  const locationRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyLocationUpdate = (loc) => {
    if (!hasValidCoordinates(loc)) return;
    locationRef.current = loc;
    if (mountedRef.current) {
      setLocation(loc);
    }
  };

  /**
   * Start (or join) progressive GPS: last-known → fresh fix; address fills in later.
   * Coalesced in location.js so Authenticate won't start a duplicate hardware request.
   */
  const startLocationAcquisition = () =>
    acquireLocationProgressive({
      onUpdate: applyLocationUpdate,
      resolveAddress: true,
    });

  useEffect(() => {
    if (authMethod === 'biometric') {
      checkBiometric();
    } else {
      checkFaceRecognition();
    }
    startLocationAcquisition().catch((err) => {
      console.warn('[AuthenticationScreen] location acquisition error:', err?.message || err);
    });
  }, [authMethod]);

  /**
   * Prefer an existing valid fix; otherwise wait for (or start) progressive acquisition.
   * Does not block on reverse geocoding.
   */
  const resolveValidLocation = async (existing) => {
    if (hasValidCoordinates(existing)) {
      // Prefer in-ref GPS if newer than what auth captured (e.g. lastKnown then upgraded).
      const latest = locationRef.current;
      if (
        hasValidCoordinates(latest) &&
        latest.source === 'gps' &&
        existing.source !== 'gps'
      ) {
        return latest;
      }
      if (hasValidCoordinates(latest) && (latest.timestamp ?? 0) >= (existing.timestamp ?? 0)) {
        return latest;
      }
      return existing;
    }
    if (hasValidCoordinates(locationRef.current)) {
      return locationRef.current;
    }
    console.log('No valid coordinates yet — waiting for progressive GPS...');
    const result = await startLocationAcquisition();
    if (hasValidCoordinates(locationRef.current)) {
      return locationRef.current;
    }
    return hasValidCoordinates(result) ? result : null;
  };

  const checkBiometric = async () => {
    try {
      const availability = await checkBiometricAvailability();
      setBiometricAvailable(availability.available);
      if (availability.available) {
        setBiometricType(getBiometricTypeName(availability.types));
      } else {
        Alert.alert(
          'Biometric Not Available',
          availability.error || 'Biometric authentication is not available. Please use Face ID instead.',
          [
            { text: 'Use Face ID', onPress: () => {
              navigation.replace('AuthenticationScreen', { 
                type: type,
                user: user,
                authMethod: 'face'
              });
            }},
            { text: 'Cancel', style: 'cancel', onPress: () => navigation.goBack() }
          ]
        );
      }
    } catch (error) {
      console.error('Error checking biometric:', error);
      Alert.alert(
        'Error', 
        'Failed to check biometric availability.',
        [
          { text: 'Use Face ID', onPress: () => {
            navigation.replace('AuthenticationScreen', { 
              type: type,
              user: user,
              authMethod: 'face'
            });
          }},
          { text: 'Cancel', style: 'cancel', onPress: () => navigation.goBack() }
        ]
      );
    }
  };

  const checkFaceRecognition = async () => {
    try {
      const availability = await checkFaceRecognitionAvailability();
      setFaceIDAvailable(availability.available);
      if (!availability.available) {
        const errorMsg = availability.error || 'Face ID is not available on this device.';
        const isEnrollmentIssue = errorMsg.includes('enrolled') || errorMsg.includes('No face recognition');
        
        Alert.alert(
          'Face ID Setup Required',
          isEnrollmentIssue 
            ? 'Face ID is not set up on this device.\n\nPlease set up Face ID in your device settings:\n\nSettings > Face ID & Passcode (iOS)\nSettings > Security > Face unlock (Android)\n\nAfter setting up Face ID, return to this app and try again.'
            : errorMsg + '\n\nPlease use fingerprint authentication instead.',
          [
            ...(isEnrollmentIssue ? [] : [
              { text: 'Use Fingerprint', onPress: () => {
                navigation.replace('AuthenticationScreen', { 
                  type: type,
                  user: user,
                  authMethod: 'biometric'
                });
              }}
            ]),
            { text: 'OK', onPress: () => navigation.goBack() }
          ]
        );
        return;
      }
    } catch (error) {
      console.error('Error checking face recognition availability:', error);
      Alert.alert(
        'Error',
        'Failed to check Face ID availability.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }
  };

  const authenticateWithFaceID = async () => {
    setIsLoading(true);
    setIsVerifying(true);
    setAuthStatus(null);

    try {
      const currentLocation = await resolveValidLocation(location);

      // Authenticate with Face ID
      const verificationResult = await verifyFace(
        user.username, 
        `Authenticate with Face ID to ${type === 'checkin' ? 'check in' : 'check out'}`
      );
      
      setIsVerifying(false);

      if (verificationResult.success) {
        setAuthStatus('success');
        Alert.alert(
          'Face ID Authentication Successful',
          `Face ID verified successfully!\n\nConfirm ${type === 'checkin' ? 'check in' : 'check out'}?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => {
              setAuthStatus(null);
              setIsLoading(false);
            }},
            { text: 'Confirm', onPress: () => saveAttendance(null, currentLocation) }
          ]
        );
      } else {
        setAuthStatus('failed');
        Alert.alert(
          'Authentication Failed',
          verificationResult.error?.includes('cancel')
            ? 'Authentication was cancelled. No attendance record was saved.'
            : verificationResult.error || 'Face ID authentication did not complete. Please try again.',
          [
            { text: 'Retry', onPress: () => {
              setAuthStatus(null);
              setIsLoading(false);
            }},
            { text: 'Cancel', style: 'cancel', onPress: () => {
              setAuthStatus(null);
              setIsLoading(false);
              navigation.goBack();
            }}
          ]
        );
      }
    } catch (error) {
      console.error('Error during Face ID authentication:', error);
      setIsVerifying(false);
      setAuthStatus('error');
      Alert.alert(
        'Authentication Failed', 
        'Failed to authenticate with Face ID. Please try again.',
        [
          { text: 'Retry', onPress: () => {
            setAuthStatus(null);
            setIsLoading(false);
          }},
          { text: 'Cancel', style: 'cancel', onPress: () => {
            setAuthStatus(null);
            setIsLoading(false);
          }}
        ]
      );
    }
  };

  const authenticateWithBiometricMethod = async () => {
    setIsLoading(true);
    setIsVerifying(true);
    setAuthStatus(null);

    try {
      const currentLocation = await resolveValidLocation(location);

      // Authenticate with biometric
      const authResult = await authenticateWithBiometric(
        `Authenticate to ${type === 'checkin' ? 'check in' : 'check out'}`
      );

      setIsVerifying(false);

      if (authResult.success) {
        setAuthStatus('success');
        Alert.alert(
          'Biometric Authentication Successful',
          `${biometricType} verified!\n\nConfirm ${type === 'checkin' ? 'check in' : 'check out'}?`,
          [
            { 
              text: 'Cancel', 
              style: 'cancel', 
              onPress: () => {
                setAuthStatus(null);
                setIsLoading(false);
              }
            },
            { 
              text: 'Confirm', 
              onPress: () => saveAttendance(null, currentLocation) 
            }
          ]
        );
      } else {
        setAuthStatus('failed');
        Alert.alert(
          'Authentication Failed',
          authResult.error?.includes('cancel')
            ? 'Authentication was cancelled. No attendance record was saved.'
            : authResult.error || 'Biometric authentication did not complete. Please try again.',
          [
            { 
              text: 'Retry', 
              onPress: () => {
                setAuthStatus(null);
                setIsLoading(false);
              }
            },
            { 
              text: 'Cancel', 
              style: 'cancel', 
              onPress: () => {
                setAuthStatus(null);
                setIsLoading(false);
                navigation.goBack();
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error('Error during biometric authentication:', error);
      setIsVerifying(false);
      setAuthStatus('error');
      Alert.alert(
        'Authentication Failed',
        'Failed to authenticate. Please try again.',
        [
          { 
            text: 'Retry', 
            onPress: () => {
              setAuthStatus(null);
              setIsLoading(false);
            }
          },
          { 
            text: 'Cancel', 
            style: 'cancel', 
            onPress: () => {
              setAuthStatus(null);
              setIsLoading(false);
            }
          }
        ]
      );
    }
  };

  const saveAttendance = async (photoUri, locationData) => {
    setIsLoading(true);
    try {
      // Prefer freshest progressive fix (GPS over last-known) for geofence accuracy.
      let location = await resolveValidLocation(
        hasValidCoordinates(locationRef.current) ? locationRef.current : locationData
      );

      const locationRequired = isLocationRequiredForCheckIn(user);

      if (locationRequired && !hasValidCoordinates(location)) {
        const refreshed = await resolveValidLocation(null);
        if (hasValidCoordinates(refreshed)) {
          location = refreshed;
        }
      }

      const [records, queuedRecords] = await Promise.all([
        getUserAttendanceRecords(user.username),
        getOfflineQueuedRecordsForUser(user.username, user),
      ]);
      let state = deriveSelfServiceAttendanceState([...(records || []), ...(queuedRecords || [])]);
      try {
        const remoteState = await getSelfServiceAttendanceState(user.username, user);
        const authoritative = normalizeAuthoritativeSelfServiceState(remoteState, state);
        if (authoritative) {
          state = authoritative;
        }
      } catch (stateError) {
        if (__DEV__) console.warn('[AuthenticationScreen] self-service state fallback:', stateError?.message || stateError);
      }

      if (type === 'checkin' && !state.canCheckIn) {
        Alert.alert('Attendance Complete', state.completed ? 'This workday is already complete.' : 'You are already checked in. Check out before checking in again.');
        return;
      }
      if (type === 'checkout' && !state.canCheckOut) {
        Alert.alert('Cannot Check Out', state.lastRecord?.type === 'checkout' ? 'This workday is already checked out.' : 'You must check in before you can check out.');
        return;
      }

      let matchedLocation = null;

      if (type === 'checkin') {
        if (locationRequired && !hasValidCoordinates(location)) {
          Alert.alert(
            'GPS Unavailable',
            'Could not get your GPS position after retrying. Please enable location services, wait a moment for a GPS fix, and try again.',
            [{ text: 'OK' }]
          );
          return;
        }

        const validation = await validateCheckInLocation(
          user,
          location.latitude,
          location.longitude
        );

        if (!validation.valid) {
          Alert.alert(
            'Outside Work Location',
            validation.error || 'You are not within an allowed work location for check-in.',
            [{ text: 'OK' }]
          );
          return;
        }

        matchedLocation = validation.matchedLocation || null;

        if (validation.warning) {
          console.warn('[AuthenticationScreen] Location validation warning:', validation.warning);
        }
      } else if (type === 'checkout') {
        const { validateCheckoutLocation } = await import('../features/geofencing/services/checkoutValidationService');
        const validation = await validateCheckoutLocation(user, location);

        if (!validation.valid) {
          Alert.alert(
            'Check-Out Blocked',
            validation.error || 'You must be within an allowed work location to check out.',
            [{ text: 'OK' }]
          );
          return;
        }

        if (validation.warning) {
          console.warn('[AuthenticationScreen] Checkout validation warning:', validation.warning);
        }
      }

      const attendanceRecord = {
        id: Date.now().toString(),
        username: user.username,
        type,
        timestamp: new Date().toISOString(),
        photo: null,
        location: hasValidCoordinates(location)
          ? {
              ...location,
              site_id: matchedLocation?.id || null,
              site_name: matchedLocation?.name || null,
            }
          : null,
        authMethod: authMethod,
      };

      const saveResult = await saveAttendanceRecord(attendanceRecord, user);

      if (!saveResult?.success) {
        Alert.alert(
          'Could Not Save',
          saveResult?.error ||
            'Your attendance could not be saved. Please try again or contact support.',
          [{ text: 'OK' }]
        );
        return;
      }

      if (type === 'checkin') {
        try {
          const { resetMonitoringAfterCheckIn } = await import('../features/geofencing/services/locationMonitoringService');
          await resetMonitoringAfterCheckIn(user, matchedLocation);
        } catch (monitorErr) {
          console.warn('[AuthenticationScreen] Could not start location monitoring:', monitorErr?.message);
        }
      } else {
        try {
          const { stopLocationMonitoring } = await import('../features/geofencing/services/locationMonitoringService');
          stopLocationMonitoring();
        } catch {
          /* ignore */
        }
      }

      const actionLabel = type === 'checkin' ? 'checked in' : 'checked out';
      let title = 'Success';
      let message = `Successfully ${actionLabel}!`;

      if (saveResult.source === 'offline') {
        title = 'Saved Offline';
        if (saveResult.reason === 'auth_unavailable') {
          message = `You are ${actionLabel} on this device, but your session could not be verified with the server. We will sync when authentication is available.`;
        } else if (saveResult.reason === 'missing_tenant') {
          message = `You are ${actionLabel} on this device, but tenant information was unavailable. We will sync when the connection is restored.`;
        } else {
          message = `You are ${actionLabel} on this device. We will sync when the connection is available.`;
        }
      }

      Alert.alert(title, message, [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error) {
      console.error('Error saving attendance:', error);
      Alert.alert('Error', 'Failed to save attendance record. Please try again.');
    } finally {
      setIsLoading(false);
      setIsVerifying(false);
    }
  };

  // Loading state
  if (authMethod === 'biometric' && !biometricAvailable) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.text, marginTop: 16 }}>Checking biometric availability...</Text>
      </View>
    );
  }

  if (authMethod === 'face' && !faceIDAvailable) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.text, marginTop: 16 }}>Checking Face ID availability...</Text>
      </View>
    );
  }

  // Biometric authentication view
  if (authMethod === 'biometric') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ padding: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
            {type === 'checkin' ? 'Check In' : 'Check Out'}
          </Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Biometric Authentication View */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 24, padding: 32, alignItems: 'center', maxWidth: 400, width: '100%', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }}>
            <View style={{ width: 96, height: 96, backgroundColor: colors.primaryLight, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
              <Ionicons name="finger-print" size={48} color={colors.primary} />
            </View>
            
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
              {type === 'checkin' ? 'Check In' : 'Check Out'} with {biometricType}
            </Text>
            <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: 24, fontSize: 14 }}>
              Use your {biometricType.toLowerCase()} to authenticate
            </Text>

            {/* Location Display */}
            <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 12, marginBottom: 24, width: '100%' }}>
              <Text style={{ color: colors.text, fontSize: 12, textAlign: 'center' }}>
                {location && hasValidCoordinates(location) ? (
                  location.address
                    ? `📍 ${formatAddressForDisplay(location.address, 40)}`
                    : location.source === 'lastKnown'
                      ? '📍 Location ready (refining GPS…)'
                      : '📍 Location captured (resolving address…)'
                ) : '📍 Getting location...'}
              </Text>
            </View>

            {/* Verification Status */}
            {authStatus && (
              <View style={{ 
                backgroundColor: authStatus === 'success' ? colors.successLight : 
                                authStatus === 'failed' ? colors.errorLight : 
                                colors.warningLight,
                borderRadius: 12,
                padding: 12,
                marginBottom: 24,
                width: '100%'
              }}>
                <Text style={{ color: authStatus === 'success' ? colors.success : 
                                         authStatus === 'failed' ? colors.error : 
                                         colors.warning, fontSize: 14, textAlign: 'center', fontWeight: '500' }}>
                  {authStatus === 'success' ? `✅ ${biometricType} verified!` :
                   authStatus === 'failed' ? '❌ Authentication failed' :
                   '⚠️ Verification error'}
                </Text>
              </View>
            )}

            {/* Authenticate Button */}
            <TouchableOpacity
              style={{
                width: '100%',
                borderRadius: 12,
                padding: 16,
                alignItems: 'center',
                backgroundColor: isLoading ? colors.border : colors.primary,
              }}
              onPress={authenticateWithBiometricMethod}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="large" color="white" />
              ) : (
                <>
                  <Ionicons name="finger-print" size={32} color="white" />
                  <Text style={{ color: 'white', fontWeight: '600', marginTop: 8, fontSize: 16 }}>
                    Authenticate with {biometricType}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={{ color: colors.textTertiary, textAlign: 'center', fontSize: 12, marginTop: 16 }}>
              User: {user.username}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Face ID authentication view
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ padding: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
          {type === 'checkin' ? 'Check In' : 'Check Out'}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Face ID Authentication View */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 24, padding: 32, alignItems: 'center', maxWidth: 400, width: '100%', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }}>
          <View style={{ width: 96, height: 96, backgroundColor: colors.primaryLight, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <Ionicons name="finger-print" size={48} color={colors.primary} />
          </View>

          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
            {type === 'checkin' ? 'Check In' : 'Check Out'} with Face ID
          </Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: 24, fontSize: 14 }}>
            Use your device's Face ID to authenticate
          </Text>

          {/* Location Display */}
          <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 12, marginBottom: 24, width: '100%' }}>
            <Text style={{ color: colors.text, fontSize: 12, textAlign: 'center' }}>
                {location && hasValidCoordinates(location) ? (
                  location.address
                    ? `📍 ${formatAddressForDisplay(location.address, 40)}`
                    : location.source === 'lastKnown'
                      ? '📍 Location ready (refining GPS…)'
                      : '📍 Location captured (resolving address…)'
                ) : '📍 Getting location...'}
              </Text>
            </View>

          {/* Verification Status */}
          {authStatus && (
            <View style={{ 
              backgroundColor: authStatus === 'success' ? colors.successLight : 
                              authStatus === 'failed' ? colors.errorLight : 
                              colors.warningLight,
              borderRadius: 12,
              padding: 12,
              marginBottom: 24,
              width: '100%'
            }}>
              <Text style={{ color: authStatus === 'success' ? colors.success : 
                                       authStatus === 'failed' ? colors.error : 
                                       colors.warning, fontSize: 14, textAlign: 'center', fontWeight: '500' }}>
                {authStatus === 'success' ? '✅ Face ID verified!' :
                 authStatus === 'failed' ? '❌ Face ID authentication failed' :
                   '⚠️ Verification error'}
                </Text>
              </View>
            )}
            
          {/* Authenticate Button */}
            <TouchableOpacity
            style={{
              width: '100%',
              borderRadius: 12,
              padding: 16,
              alignItems: 'center',
              backgroundColor: isLoading ? colors.border : colors.primary,
            }}
            onPress={authenticateWithFaceID}
              disabled={isLoading}
            >
              {isLoading ? (
              <ActivityIndicator size="large" color="white" />
              ) : (
              <>
                <Ionicons name="finger-print" size={32} color="white" />
                <Text style={{ color: 'white', fontWeight: '600', marginTop: 8, fontSize: 16 }}>
                  Authenticate with Face ID
                </Text>
              </>
              )}
            </TouchableOpacity>
            
          <Text style={{ color: colors.textTertiary, textAlign: 'center', fontSize: 12, marginTop: 16 }}>
            User: {user.username}
            </Text>
        </View>
      </View>
    </View>
  );
}



