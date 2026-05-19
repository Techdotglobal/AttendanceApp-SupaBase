import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { saveAttendanceRecord } from '../utils/storage';
import { 
  verifyFace, 
  checkFaceRecognitionAvailability
} from '../utils/faceVerification';
import { 
  authenticateWithBiometric, 
  checkBiometricAvailability,
  getBiometricTypeName 
} from '../utils/biometricAuth';
import { getCurrentLocationWithAddress, formatAddressForDisplay } from '../utils/location';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';
import { validateCheckInLocation } from '../features/geofencing';

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

  useEffect(() => {
    if (authMethod === 'biometric') {
      checkBiometric();
    } else {
      checkFaceRecognition();
    }
    // Get location
    getLocation();
  }, [authMethod]);

  const getLocation = async () => {
    try {
      console.log('Fetching location...');
      const currentLocation = await getCurrentLocationWithAddress();
      if (currentLocation) {
        console.log('Location fetched successfully:', {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          address: currentLocation.address ? currentLocation.address.substring(0, 50) + '...' : 'N/A'
        });
        setLocation(currentLocation);
      } else {
        console.warn('Location fetch returned null - location may not be available');
        // Set a default location object so the UI doesn't break
        setLocation({
          latitude: null,
          longitude: null,
          accuracy: null,
          address: 'Location unavailable'
        });
      }
    } catch (error) {
      console.error('Error getting location:', error);
      // Set a default location object so the UI doesn't break
      setLocation({
        latitude: null,
        longitude: null,
        accuracy: null,
        address: 'Location unavailable'
      });
    }
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
      // Get location first (with error handling)
      let currentLocation = location; // Use existing location if available
      if (!currentLocation) {
        console.log('Fetching location for Face ID authentication...');
        currentLocation = await getCurrentLocationWithAddress();
        if (currentLocation) {
          setLocation(currentLocation);
        } else {
          // Continue without location if it fails
          console.warn('Location fetch failed, continuing without location');
          currentLocation = {
            latitude: null,
            longitude: null,
            accuracy: null,
            address: 'Location unavailable'
          };
        }
      }

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
          'Face ID Authentication Failed',
          verificationResult.error || 'Face ID authentication failed. Please try again.',
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
        'Error', 
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
      // Get location first (with error handling)
      let currentLocation = location; // Use existing location if available
      if (!currentLocation) {
        console.log('Fetching location for biometric authentication...');
        currentLocation = await getCurrentLocationWithAddress();
        if (currentLocation) {
          setLocation(currentLocation);
        } else {
          // Continue without location if it fails
          console.warn('Location fetch failed, continuing without location');
          currentLocation = {
            latitude: null,
            longitude: null,
            accuracy: null,
            address: 'Location unavailable'
          };
        }
      }

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
          authResult.error || 'Biometric authentication failed. Please try again.',
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
        'Error',
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
    try {
      // Ensure location is properly formatted (handle null/undefined)
      const location = locationData || {
        latitude: null,
        longitude: null,
        accuracy: null,
        address: 'Location unavailable'
      };

      // GEOFENCING VALIDATION
      if (type === 'checkin') {
        // Validate location coordinates are available
        if (!location.latitude || !location.longitude) {
          Alert.alert(
            'Location Required',
            'Unable to get your current location. Please enable location services and try again.',
            [{ text: 'OK' }]
          );
          return;
        }

        // Validate check-in location based on work mode
        const validation = await validateCheckInLocation(
          user,
          location.latitude,
          location.longitude
        );

        if (!validation.valid) {
          // Block check-in if validation fails
          Alert.alert(
            'Check-In Blocked',
            validation.error || 'You must be within the office location to check in.',
            [{ text: 'OK' }]
          );
          return;
        }

        // Log warning if present (non-blocking)
        if (validation.warning) {
          console.warn('[AuthenticationScreen] Location validation warning:', validation.warning);
        }
      } else if (type === 'checkout') {
        // Validate checkout location (only if auto_checkout is disabled)
        const { validateCheckoutLocation } = await import('../features/geofencing/services/checkoutValidationService');
        const validation = await validateCheckoutLocation(user, location);

        if (!validation.valid) {
          // Block checkout if validation fails
          Alert.alert(
            'Check-Out Blocked',
            validation.error || 'You must be within 1km of the office to check out.',
            [{ text: 'OK' }]
          );
          return;
        }

        // Log warning if present (non-blocking)
        if (validation.warning) {
          console.warn('[AuthenticationScreen] Checkout validation warning:', validation.warning);
        }
      }

      const attendanceRecord = {
        id: Date.now().toString(),
        username: user.username,
        type: type,
        timestamp: new Date().toISOString(),
        photo: null, // No photo needed for device-native authentication
        location: location,
        authMethod: authMethod, // Store which authentication method was used
      };

      console.log('Saving attendance record:', {
        username: attendanceRecord.username,
        type: attendanceRecord.type,
        hasLocation: !!attendanceRecord.location,
        locationAddress: attendanceRecord.location?.address || 'N/A'
      });

      const saveResult = await saveAttendanceRecord(attendanceRecord);

      if (!saveResult?.success) {
        Alert.alert(
          'Could Not Save',
          saveResult?.error ||
            'Your check-in could not be saved. Please try again or contact support.',
          [{ text: 'OK' }]
        );
        return;
      }

      const actionLabel = type === 'checkin' ? 'checked in' : 'checked out';
      const title = saveResult.source === 'supabase' ? 'Success' : 'Saved Offline';
      const message =
        saveResult.source === 'supabase'
          ? `Successfully ${actionLabel}!`
          : `You are ${actionLabel} on this device. We will sync to the server when the connection is available.`;

      Alert.alert(title, message, [
        {
          text: 'OK',
          onPress: () => {
            navigation.goBack();
          },
        },
      ]);
    } catch (error) {
      console.error('Error saving attendance:', error);
      Alert.alert('Error', 'Failed to save attendance record');
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
                {location ? (
                  location.address ? 
                    `📍 ${formatAddressForDisplay(location.address, 40)}` : 
                    '📍 Location captured'
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
                {location ? (
                  location.address ? 
                    `📍 ${formatAddressForDisplay(location.address, 40)}` : 
                    '📍 Location captured'
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



