import React, { useState, useEffect, useCallback } from 'react';
import { useLocationState } from '../features/geofencing/hooks/useLocationState';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScreen } from '../shared/components/KeyboardAwareScreen';
import { Ionicons } from '@expo/vector-icons';
import { getUserAttendanceRecords, getOfflineQueuedRecordsForUser, getSelfServiceAttendanceState } from '../utils/storage';
import { useAuth } from '../contexts/AuthContext';
import { 
  getEmployeeByUsername, 
  createWorkModeRequest,
  getWorkModeRequests 
} from '../utils/employees';
import { 
  getAllWorkModes, 
  getWorkModeLabel, 
  getWorkModeColor,
  getWorkModeIcon 
} from '../utils/workModes';
import { 
  checkBiometricAvailability, 
  hasFingerprintSupport,
  getBiometricTypeName 
} from '../utils/biometricAuth';
import { getPreferredAuthMethod } from '../utils/authPreferences';
import { useTheme } from '../contexts/ThemeContext';
import { getUnreadNotificationCount } from '../utils/notifications';
import { getEmployeeLeaveBalance, calculateRemainingLeaves } from '../utils/leaveManagement';
import { getEmployeeQuickStats } from '../utils/analytics';
import { 
  getHRRoleFromPosition, 
  getHRRoleColor, 
  getHRRoleIcon, 
  getHRRoleLabel 
} from '../utils/hrRoles';
import { spacing, iconSize, componentSize, responsivePadding, responsiveFont, dashboardTitleFont, wp, isTablet, normalize } from '../utils/responsive';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';
import HamburgerButton from '../shared/components/HamburgerButton';
import { useNavigation } from '@react-navigation/native';
import { useStaleWhileRevalidate } from '../shared/hooks/useStaleWhileRevalidate';
const {
  deriveSelfServiceAttendanceState,
  normalizeAuthoritativeSelfServiceState,
} = require('../../../shared/attendance/selfServiceState.cjs');

export default function EmployeeDashboard({ route }) {
  const navigation = useNavigation();
  const { user: routeUser } = route.params || {};
  const { user: authUser, handleLogout } = useAuth();
  const user = authUser
    ? { ...(routeUser || {}), ...authUser, workMode: authUser.workMode ?? authUser.work_mode ?? routeUser?.workMode, work_mode: authUser.work_mode ?? authUser.workMode ?? routeUser?.work_mode }
    : routeUser;
  const { colors } = useTheme();
  const tablet = isTablet();
  const tabletContentStyle = {
    width: '100%',
    maxWidth: tablet ? 1000 : undefined,
    alignSelf: 'center',
  };
  const [lastRecord, setLastRecord] = useState(null);
  const [attendanceState, setAttendanceState] = useState({ canCheckIn: true, canCheckOut: false, completed: false });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [showWorkModeModal, setShowWorkModeModal] = useState(false);
  const [selectedWorkMode, setSelectedWorkMode] = useState(null);
  const [requestReason, setRequestReason] = useState('');
  const [submittingWorkModeRequest, setSubmittingWorkModeRequest] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState('');
  const [hasFingerprint, setHasFingerprint] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [remainingLeaves, setRemainingLeaves] = useState(null);
  const [quickStats, setQuickStats] = useState({
    daysWorked: 0,
    hoursLogged: 0,
    thisMonth: 0,
  });
  const [quickStatsLoading, setQuickStatsLoading] = useState(true);
  const [quickStatsError, setQuickStatsError] = useState(null);

  const loadNotificationCount = useCallback(async () => {
    try {
      if (!user?.username) return;
      const count = await getUnreadNotificationCount(user.username);
      setUnreadNotificationCount(count);
    } catch (error) {
      console.error('Error loading notification count:', error);
    }
  }, [user?.username]);

  const loadLastRecord = useCallback(async () => {
    try {
      if (!user?.username) return;
      const [onlineRecords, offlineRecords] = await Promise.all([
        getUserAttendanceRecords(user.username),
        getOfflineQueuedRecordsForUser(user.username),
      ]);
      const all = [...onlineRecords, ...offlineRecords];
      if (all.length > 0) {
        const sortedRecords = all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setLastRecord(sortedRecords[0]);
        setAttendanceState(deriveSelfServiceAttendanceState(all));
      } else {
        setLastRecord(null);
        setAttendanceState({ canCheckIn: true, canCheckOut: false, completed: false });
      }
      try {
        const remoteState = await getSelfServiceAttendanceState(user.username, user);
        const authoritative = normalizeAuthoritativeSelfServiceState(
          remoteState,
          deriveSelfServiceAttendanceState(all),
        );
        if (authoritative) {
          setAttendanceState(authoritative);
          if (Object.prototype.hasOwnProperty.call(remoteState || {}, 'latest_record')) {
            setLastRecord(authoritative.lastRecord);
          }
        }
      } catch (stateError) {
        if (__DEV__) console.warn('[EmployeeDashboard] self-service state fallback:', stateError?.message || stateError);
      }
    } catch (error) {
      console.error('Error loading last record:', error);
    }
  }, [user?.username, user?.uid, user?.companyId, user?.company_id, user?.role]);

  const loadEmployeeData = useCallback(async () => {
    try {
      if (!user?.username) return;
      const employeeData = await getEmployeeByUsername(user.username, user.companyId);
      setEmployee(employeeData);
    } catch (error) {
      console.error('Error loading employee data:', error);
    }
  }, [user?.username, user?.companyId]);

  const loadMyRequests = useCallback(async () => {
    try {
      if (!user?.uid) return;
      const requests = await getWorkModeRequests(user, { ownOnly: true });
      setMyRequests(
        requests.filter(
          (req) =>
            req.employeeUid === user.uid ||
            req.employeeId === `emp_${user.uid}` ||
            req.employeeId === user.username
        )
      );
    } catch (error) {
      console.error('Error loading my requests:', error);
    }
  }, [user?.uid, user?.username]);

  const hasPendingWorkModeRequest = myRequests.some((r) => r.status === 'pending');

  const loadQuickStats = useCallback(async ({ showLoading = false } = {}) => {
    if (!user?.username) {
      setQuickStatsLoading(false);
      return;
    }
    if (showLoading) setQuickStatsLoading(true);
    setQuickStatsError(null);
    try {
      const result = await getEmployeeQuickStats(user.username);
      if (result.success) {
        setQuickStats({
          daysWorked: result.daysWorked ?? 0,
          hoursLogged: result.hoursLogged ?? 0,
          thisMonth: result.thisMonth ?? 0,
        });
      } else {
        setQuickStatsError(result.error || 'Could not load stats');
      }
    } catch (error) {
      console.error('Error loading quick stats:', error);
      setQuickStatsError('Could not load stats');
    } finally {
      setQuickStatsLoading(false);
    }
  }, [user?.username]);

  const loadLeaveBalance = useCallback(async () => {
    try {
      if (employee) {
        const balance = await getEmployeeLeaveBalance(employee.id);
        const remaining = calculateRemainingLeaves(balance);
        setLeaveBalance(balance);
        setRemainingLeaves(remaining);
      }
    } catch (error) {
      console.error('Error loading leave balance:', error);
    }
  }, [employee]);

  const loadData = useCallback(async () => {
    await Promise.all([
      loadLastRecord(),
      loadEmployeeData(),
      loadMyRequests(),
      loadNotificationCount(),
      loadLeaveBalance(),
      loadQuickStats({ showLoading: false }),
    ]);
  }, [
    loadLastRecord,
    loadEmployeeData,
    loadMyRequests,
    loadNotificationCount,
    loadLeaveBalance,
    loadQuickStats,
  ]);

  const { refreshOnFocus, refreshForced } = useStaleWhileRevalidate(loadData, {
    minIntervalMs: 2500,
  });

  useEffect(() => {
    void refreshForced();
    setTimeout(() => {
      checkBiometricSupport();
    }, 1000);

    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('focus', () => {
          void refreshOnFocus();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[EmployeeDashboard] Failed to add navigation listener:', error);
        }
      }
    }

    const notificationInterval = setInterval(() => {
      loadNotificationCount();
    }, 30000);

    const { AppState } = require('react-native');
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        loadNotificationCount();
      }
    };
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          if (__DEV__) {
            console.warn('[EmployeeDashboard] Error unsubscribing navigation listener:', error);
          }
        }
      }
      clearInterval(notificationInterval);
      appStateSubscription?.remove();
    };
  }, [navigation, refreshForced, refreshOnFocus, loadNotificationCount]);

  const checkBiometricSupport = async () => {
    try {
      // Wrap in try-catch to prevent crashes
      const availability = await checkBiometricAvailability();
      setBiometricAvailable(availability.available);
      
      if (availability.available) {
        const fingerprintSupport = await hasFingerprintSupport();
        setHasFingerprint(fingerprintSupport);
        setBiometricType(getBiometricTypeName(availability.types));
      }
    } catch (error) {
      console.error('Error checking biometric support:', error);
      // Silently fail - assume biometric not available
      setBiometricAvailable(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadQuickStats({ showLoading: true });
    await refreshForced();
    setIsRefreshing(false);
  };

  const handleCheckIn = async () => {
    // Get user's preferred authentication method
    const authMethod = await getPreferredAuthMethod(user.username, biometricAvailable);
    navigation.navigate('AuthenticationScreen', { 
      type: 'checkin',
      user: user,
      authMethod: authMethod
    });
  };

  const handleCheckOut = async () => {
    // Get user's preferred authentication method
    const authMethod = await getPreferredAuthMethod(user.username, biometricAvailable);
    navigation.navigate('AuthenticationScreen', { 
      type: 'checkout',
      user: user,
      authMethod: authMethod
    });
  };

  const handleWorkModeRequest = (workMode) => {
    if (hasPendingWorkModeRequest) {
      Alert.alert(
        'Pending Request',
        'A pending work mode request already exists. Wait for it to be processed before submitting another.'
      );
      return;
    }
    setSelectedWorkMode(workMode);
    setShowWorkModeModal(true);
  };

  const submitWorkModeRequest = async () => {
    if (submittingWorkModeRequest) return;
    if (!selectedWorkMode || !requestReason.trim()) {
      Alert.alert('Validation failed', 'Please select a work mode and provide a reason');
      return;
    }
    if (hasPendingWorkModeRequest) {
      Alert.alert('Pending Request', 'A pending request already exists.');
      return;
    }

    setSubmittingWorkModeRequest(true);
    try {
      const result = await createWorkModeRequest(
        user.username,
        selectedWorkMode,
        requestReason.trim(),
        user
      );

      if (result?.success) {
        Alert.alert(
          'Request Submitted',
          result.message || 'Your work mode change request has been submitted for admin approval.'
        );
        setShowWorkModeModal(false);
        setSelectedWorkMode(null);
        setRequestReason('');
        await loadMyRequests();
      } else {
        Alert.alert('Error', result?.error || 'Failed to submit request');
      }
    } catch (error) {
      console.error('Error submitting work mode request:', error);
      Alert.alert('Error', error?.message || 'Failed to submit request');
    } finally {
      setSubmittingWorkModeRequest(false);
    }
  };

  const handleViewHistory = () => {
    navigation.navigate('AttendanceHistory', { user: user });
  };

  const handleLogoutPress = () => {
    handleLogout();
  };

  const canCheckIn = attendanceState.canCheckIn;
  const canCheckOut = attendanceState.canCheckOut;

  // Track location state when checked in
  const locationState = useLocationState(user, canCheckOut, 30000); // Poll every 30 seconds

  // When auto-checkout is OFF and user is outside the radius, block the manual checkout button
  const isCheckoutLocationBlocked =
    canCheckOut &&
    locationState.isInside === false &&
    !locationState.autoCheckoutEnabled;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }} edges={['top']}>
      <ScrollView 
        className="flex-1"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: responsivePadding(24),
          alignItems: tablet ? 'center' : 'stretch',
        }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <View style={tabletContentStyle}>
        {/* Welcome Header */}
        <View 
          className="rounded-2xl shadow-sm"
          style={{ 
            backgroundColor: colors.surface,
            marginBottom: spacing.lg,
          }}
        >
          <View className="flex-row items-center justify-between" style={{ padding: responsivePadding(24) }}>
            <HamburgerButton color={colors.text} size={28} style={{ marginRight: spacing.sm }} />
            <View className="flex-row items-center flex-1" style={{ flexShrink: 1 }}>
              <Logo size="small" style={{ marginRight: spacing.md }} />
              <View className="flex-1" style={{ flexShrink: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
                  <Text 
                    className="font-bold"
                    style={{ 
                      color: colors.text,
                      fontSize: dashboardTitleFont(20),
                      flexShrink: 0,
                    }}
                  >
                    Welcome,{' '}
                  </Text>
                  <Text 
                    className="font-bold"
                    style={{ 
                      color: colors.text,
                      fontSize: dashboardTitleFont(20),
                      flex: 1,
                      minWidth: 0,
                    }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {user.username}!
                  </Text>
                </View>
              <View className="flex-row items-center flex-wrap">
                <Text 
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                  }}
                >
                  Employee Dashboard
                </Text>
                {employee && employee.position && (
                  <>
                    <Text 
                      style={{ 
                        color: colors.textTertiary, 
                        marginHorizontal: spacing.xs,
                        fontSize: responsiveFont(12),
                      }}
                    >
                      •
                    </Text>
                    <View className="flex-row items-center">
                      <Ionicons 
                        name={getHRRoleIcon(getHRRoleFromPosition(employee.position))} 
                        size={iconSize.xs} 
                        color={getHRRoleColor(getHRRoleFromPosition(employee.position))} 
                      />
                      <Text 
                        className="font-medium"
                        style={{ 
                          color: getHRRoleColor(getHRRoleFromPosition(employee.position)),
                          fontSize: responsiveFont(10),
                          marginLeft: spacing.xs / 2,
                        }}
                        numberOfLines={1}
                      >
                        {getHRRoleLabel(getHRRoleFromPosition(employee.position))}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Logout',
                  'Are you sure you want to logout?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Logout', style: 'destructive', onPress: handleLogout },
                  ]
                );
              }}
              style={{ 
                padding: spacing.xs,
                marginLeft: spacing.sm,
              }}
            >
              <Ionicons name="log-out-outline" size={iconSize.lg} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Current Status */}
        <View 
          className="rounded-2xl shadow-sm"
          style={{ 
            backgroundColor: colors.surface,
            padding: responsivePadding(24),
            marginBottom: spacing.lg,
          }}
        >
          <Text 
            className="font-semibold"
            style={{ 
              color: colors.text,
              fontSize: responsiveFont(tablet ? 17 : 18),
              marginBottom: spacing.md,
            }}
          >
            Current Status
          </Text>
          {lastRecord ? (
            <View className="flex-row items-center">
              <View 
                className="rounded-full"
                style={{ 
                  width: normalize(8),
                  height: normalize(8),
                  backgroundColor: lastRecord.type === 'checkin' ? colors.success : colors.error,
                  marginRight: spacing.md,
                }}
              />
              <View className="flex-1" style={{ flexShrink: 1 }}>
                <Text 
                  className="font-medium"
                  style={{ 
                    color: colors.text,
                    fontSize: responsiveFont(16),
                  }}
                >
                  {lastRecord.type === 'checkin'
                    ? 'Checked In'
                    : lastRecord.checkout_source === 'automatic_schedule'
                      ? 'Automatically Checked Out'
                      : 'Checked Out'}
                </Text>
                <Text 
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                >
                  {new Date(lastRecord.timestamp).toLocaleString()}
                </Text>
              </View>
            </View>
          ) : (
            <View className="flex-row items-center">
              <View 
                className="rounded-full"
                style={{ 
                  width: normalize(8),
                  height: normalize(8),
                  backgroundColor: colors.textTertiary,
                  marginRight: spacing.md,
                }}
              />
              <Text 
                style={{ 
                  color: colors.textSecondary,
                  fontSize: responsiveFont(14),
                }}
              >
                No attendance records yet
              </Text>
            </View>
          )}
        </View>

        {/* Location Warning Banner - Show when outside radius and auto checkout is disabled */}
        {canCheckOut && locationState.isInside === false && !locationState.autoCheckoutEnabled && (
          <View
            className="rounded-xl"
            style={{
              backgroundColor: '#FEF3C7',
              borderWidth: 1,
              borderColor: '#F59E0B',
              padding: spacing.md,
              marginBottom: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Ionicons
              name="warning"
              size={iconSize.lg}
              color="#F59E0B"
              style={{ marginRight: spacing.sm }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: responsiveFont(14),
                  fontWeight: '600',
                  color: '#92400E',
                  marginBottom: spacing.xs / 2,
                }}
              >
                Outside Office Area
              </Text>
              <Text
                style={{
                  fontSize: responsiveFont(12),
                  color: '#92400E',
                  lineHeight: 16,
                }}
              >
                You are {locationState.formattedDistance || 'outside'} from the office. Manual checkout is blocked until you return within 1km.
              </Text>
            </View>
          </View>
        )}

        {/* Leave Balance Card */}
        {leaveBalance && remainingLeaves && (
          <View 
            className="rounded-2xl shadow-sm"
            style={{ 
              backgroundColor: colors.surface,
              padding: responsivePadding(24),
              marginBottom: spacing.lg,
            }}
          >
            <View className="flex-row items-center justify-between" style={{ marginBottom: spacing.md }}>
              <Text 
                className="font-semibold"
                style={{ 
                  color: colors.text,
                  fontSize: responsiveFont(18),
                }}
              >
                Leave Balance
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('LeaveRequestScreen', { user: user })}
              >
                <Text 
                  className="font-medium"
                  style={{ 
                    color: colors.primary,
                    fontSize: responsiveFont(12),
                  }}
                >
                  View Details →
                </Text>
              </TouchableOpacity>
            </View>
            <View style={{ gap: spacing.md }}>
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center" style={{ flexShrink: 1 }}>
                  <View 
                    className="rounded-full"
                    style={{ 
                      width: normalize(6),
                      height: normalize(6),
                      backgroundColor: colors.primary,
                      marginRight: spacing.xs,
                    }}
                  />
                  <Text 
                    style={{ 
                      color: colors.textSecondary,
                      fontSize: responsiveFont(14),
                    }}
                  >
                    Annual Leaves
                  </Text>
                </View>
                <Text 
                  className="font-semibold"
                  style={{ 
                    color: colors.text,
                    fontSize: responsiveFont(14),
                  }}
                >
                  {remainingLeaves.annual} / {leaveBalance.annualLeaves}
                </Text>
              </View>
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center" style={{ flexShrink: 1 }}>
                  <View 
                    className="rounded-full"
                    style={{ 
                      width: normalize(6),
                      height: normalize(6),
                      backgroundColor: colors.success,
                      marginRight: spacing.xs,
                    }}
                  />
                  <Text 
                    style={{ 
                      color: colors.textSecondary,
                      fontSize: responsiveFont(14),
                    }}
                  >
                    Sick Leaves
                  </Text>
                </View>
                <Text 
                  className="font-semibold"
                  style={{ 
                    color: colors.text,
                    fontSize: responsiveFont(14),
                  }}
                >
                  {remainingLeaves.sick} / {leaveBalance.sickLeaves}
                </Text>
              </View>
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center" style={{ flexShrink: 1 }}>
                  <View 
                    className="rounded-full"
                    style={{ 
                      width: normalize(6),
                      height: normalize(6),
                      backgroundColor: colors.warning,
                      marginRight: spacing.xs,
                    }}
                  />
                  <Text 
                    style={{ 
                      color: colors.textSecondary,
                      fontSize: responsiveFont(14),
                    }}
                  >
                    Casual Leaves
                  </Text>
                </View>
                <Text 
                  className="font-semibold"
                  style={{ 
                    color: colors.text,
                    fontSize: responsiveFont(14),
                  }}
                >
                  {remainingLeaves.casual} / {leaveBalance.casualLeaves}
                </Text>
              </View>
              <View 
                className="border-t"
                style={{ 
                  borderColor: colors.border,
                  paddingTop: spacing.md,
                  marginTop: spacing.xs,
                }}
              >
                <View className="flex-row justify-between items-center">
                  <Text 
                    className="font-semibold"
                    style={{ 
                      color: colors.text,
                      fontSize: responsiveFont(14),
                    }}
                  >
                    Total Remaining
                  </Text>
                  <Text 
                    className="font-bold"
                    style={{ 
                      color: colors.primary,
                      fontSize: responsiveFont(18),
                    }}
                  >
                    {remainingLeaves.total} days
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Action Buttons */}
        <View className="space-y-4">
          {/* Check In Button */}
          <TouchableOpacity
            className="rounded-2xl shadow-sm"
            style={{
              backgroundColor: canCheckIn ? colors.success : colors.border,
              padding: responsivePadding(24),
              marginBottom: spacing.md,
            }}
            onPress={handleCheckIn}
            disabled={!canCheckIn}
          >
            <View className="flex-row items-center">
              <View 
                className="rounded-full items-center justify-center"
                style={{
                  backgroundColor: colors.surface,
                  width: componentSize.avatarMedium,
                  height: componentSize.avatarMedium,
                  marginRight: spacing.md,
                }}
              >
                <Ionicons 
                  name="log-in-outline" 
                  size={iconSize.lg} 
                  color={canCheckIn ? colors.success : colors.textTertiary} 
                />
              </View>
              <View className="flex-1" style={{ flexShrink: 1 }}>
                <Text 
                  className="font-semibold"
                  style={{ 
                    color: canCheckIn ? '#ffffff' : colors.textTertiary,
                    fontSize: responsiveFont(18) 
                  }}
                >
                  Check In
                </Text>
                <Text 
                  style={{ 
                    color: canCheckIn ? colors.successLight : colors.textTertiary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                >
                  {canCheckIn 
                    ? (biometricAvailable 
                        ? `Use ${biometricType.toLowerCase()}` 
                        : 'Use Face ID or fingerprint')
                    : (attendanceState.completed ? 'Workday completed' : 'Already checked in')}
                </Text>
              </View>
              <Ionicons 
                name="chevron-forward" 
                size={iconSize.md} 
                color={canCheckIn ? "white" : colors.textTertiary} 
              />
            </View>
          </TouchableOpacity>

          {/* Check Out Button */}
          <TouchableOpacity
            className="rounded-2xl shadow-sm"
            style={{
              backgroundColor: !canCheckOut || isCheckoutLocationBlocked ? colors.border : colors.error,
              padding: responsivePadding(24),
              marginBottom: spacing.md,
            }}
            onPress={handleCheckOut}
            disabled={!canCheckOut || isCheckoutLocationBlocked}
          >
            <View className="flex-row items-center">
              <View
                className="rounded-full items-center justify-center"
                style={{
                  backgroundColor: colors.surface,
                  width: componentSize.avatarMedium,
                  height: componentSize.avatarMedium,
                  marginRight: spacing.md,
                }}
              >
                <Ionicons
                  name="log-out-outline"
                  size={iconSize.lg}
                  color={!canCheckOut || isCheckoutLocationBlocked ? colors.textTertiary : colors.error}
                />
              </View>
              <View className="flex-1" style={{ flexShrink: 1 }}>
                <Text
                  className="font-semibold"
                  style={{
                    color: !canCheckOut || isCheckoutLocationBlocked ? colors.textTertiary : '#ffffff',
                    fontSize: responsiveFont(18)
                  }}
                >
                  Check Out
                </Text>
                <Text
                  style={{
                    color: colors.textTertiary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                >
                  {!canCheckOut
                    ? 'Must check in first'
                    : isCheckoutLocationBlocked
                    ? 'Return to office area to check out'
                    : (biometricAvailable
                        ? `Use ${biometricType.toLowerCase()}`
                        : 'Use Face ID or fingerprint')}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={iconSize.md}
                color={!canCheckOut || isCheckoutLocationBlocked ? colors.textTertiary : 'white'}
              />
            </View>
          </TouchableOpacity>

          {/* View History Button */}
          <TouchableOpacity
            className="rounded-2xl p-6 shadow-sm"
            style={{ backgroundColor: colors.surface }}
            onPress={handleViewHistory}
          >
            <View className="flex-row items-center">
              <View 
                className="w-12 h-12 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: colors.primaryLight }}
              >
                <Ionicons name="time-outline" size={24} color={colors.primary} />
              </View>
              <View className="flex-1">
                <Text 
                  className="text-lg font-semibold"
                  style={{ color: colors.text }}
                >
                  View History
                </Text>
                <Text 
                  className="text-sm"
                  style={{ color: colors.textSecondary }}
                >
                  Check your attendance records
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* Leave Requests Button */}
          <TouchableOpacity
            className="rounded-2xl p-6 shadow-sm mt-4"
            style={{ backgroundColor: colors.surface }}
            onPress={() => navigation.navigate('LeaveRequestScreen', { user: user })}
          >
            <View className="flex-row items-center">
              <View 
                className="w-12 h-12 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: colors.warningLight }}
              >
                <Ionicons name="calendar-outline" size={24} color={colors.warning} />
              </View>
              <View className="flex-1">
                <Text 
                  className="text-lg font-semibold"
                  style={{ color: colors.text }}
                >
                  Leave Requests
                </Text>
                <Text 
                  className="text-sm"
                  style={{ color: colors.textSecondary }}
                >
                  Request and manage your leaves
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* Calendar Button */}
          <TouchableOpacity
            className="rounded-2xl p-6 shadow-sm mt-4"
            style={{ backgroundColor: colors.surface }}
            onPress={() => navigation.navigate('CalendarScreen', { user: user })}
          >
            <View className="flex-row items-center">
              <View 
                className="w-12 h-12 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: colors.primaryLight }}
              >
                <Ionicons name="calendar" size={24} color={colors.primary} />
              </View>
              <View className="flex-1">
                <Text 
                  className="text-lg font-semibold"
                  style={{ color: colors.text }}
                >
                  Calendar
                </Text>
                <Text 
                  className="text-sm"
                  style={{ color: colors.textSecondary }}
                >
                  View meetings, reminders, and events
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* Notifications Button */}
          <TouchableOpacity
            className="rounded-2xl p-6 shadow-sm mt-4"
            style={{ backgroundColor: colors.surface }}
            onPress={() => navigation.navigate('NotificationsScreen', { user: user })}
          >
            <View className="flex-row items-center">
              <View 
                className="w-12 h-12 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: colors.primaryLight }}
              >
                <Ionicons name="notifications" size={24} color={colors.primary} />
                {unreadNotificationCount > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      backgroundColor: colors.error,
                      borderRadius: 10,
                      minWidth: 20,
                      height: 20,
                      paddingHorizontal: 6,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>
                      {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                    </Text>
                  </View>
                )}
              </View>
              <View className="flex-1">
                <Text 
                  className="text-lg font-semibold"
                  style={{ color: colors.text }}
                >
                  Notifications
                </Text>
                <Text 
                  className="text-sm"
                  style={{ color: colors.textSecondary }}
                >
                  {unreadNotificationCount > 0 
                    ? `${unreadNotificationCount} unread notification${unreadNotificationCount !== 1 ? 's' : ''}`
                    : 'View your notifications'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* Tickets Button */}
          <TouchableOpacity
            className="rounded-2xl p-6 shadow-sm mt-4"
            style={{ backgroundColor: colors.surface }}
            onPress={() => navigation.navigate('TicketScreen', { user: user })}
          >
            <View className="flex-row items-center">
              <View 
                className="w-12 h-12 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: '#ef444420' }}
              >
                <Ionicons name="ticket-outline" size={24} color="#ef4444" />
              </View>
              <View className="flex-1">
                <Text 
                  className="text-lg font-semibold"
                  style={{ color: colors.text }}
                >
                  Tickets
                </Text>
                <Text 
                  className="text-sm"
                  style={{ color: colors.textSecondary }}
                >
                  Raise and track support tickets
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* Authentication Settings Button */}
          <TouchableOpacity
            className="rounded-2xl p-6 shadow-sm mt-4"
            style={{ backgroundColor: colors.surface }}
            onPress={() => navigation.navigate('AuthMethodSelection', { user: user })}
          >
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-full items-center justify-center mr-4" style={{ backgroundColor: colors.primaryLight }}>
                <Ionicons name="finger-print" size={24} color={colors.primary} />
              </View>
              <View className="flex-1">
                <Text className="text-lg font-semibold" style={{ color: colors.text }}>
                  Authentication Settings
                </Text>
                <Text className="text-sm" style={{ color: colors.textSecondary }}>
                  Choose face verification or fingerprint
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Work Mode Section */}
        {employee && (
          <View className="rounded-2xl p-6 mt-6 shadow-sm" style={{ backgroundColor: colors.surface }}>
            <Text className="text-lg font-semibold mb-4" style={{ color: colors.text }}>
              Work Mode
            </Text>
            
            {/* Current Work Mode */}
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center">
                <Ionicons 
                  name={getWorkModeIcon(employee.workMode)} 
                  size={20} 
                  color={getWorkModeColor(employee.workMode)} 
                />
                <View className="ml-3">
                  <Text className="font-medium" style={{ color: colors.text }}>
                    Current: {getWorkModeLabel(employee.workMode)}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.textTertiary }}>
                    {employee.department} • {employee.position}
                  </Text>
                </View>
              </View>
            </View>

            {/* Work Mode Request Buttons */}
            <Text className="text-sm mb-3" style={{ color: colors.textSecondary }}>
              {hasPendingWorkModeRequest
                ? 'You have a pending work mode request. New requests are disabled until it is processed.'
                : 'Request a different work mode:'}
            </Text>
            <View className="space-y-2">
              {getAllWorkModes()
                .filter(mode => mode.value !== employee.workMode)
                .map((mode) => (
                  <TouchableOpacity
                    key={mode.value}
                    className="flex-row items-center p-3 rounded-lg"
                    style={{
                      backgroundColor: colors.background,
                      opacity: hasPendingWorkModeRequest ? 0.5 : 1,
                    }}
                    disabled={hasPendingWorkModeRequest}
                    onPress={() => handleWorkModeRequest(mode.value)}
                  >
                    <Ionicons 
                      name={mode.icon} 
                      size={20} 
                      color={mode.color} 
                    />
                    <View className="ml-3 flex-1">
                      <Text className="font-medium" style={{ color: colors.text }}>
                        {mode.label}
                      </Text>
                      <Text className="text-sm" style={{ color: colors.textTertiary }}>
                        {mode.description}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))}
            </View>

            {/* My Requests */}
            {myRequests.length > 0 && (
              <View className="mt-4 pt-4 border-t" style={{ borderColor: colors.border }}>
                <Text className="text-sm font-medium mb-2" style={{ color: colors.text }}>
                  My Requests ({myRequests.length})
                </Text>
                {myRequests.slice(0, 2).map((request) => (
                  <View key={request.id} className="flex-row items-center justify-between py-2">
                    <View>
                      <Text className="text-sm" style={{ color: colors.textSecondary }}>
                        {getWorkModeLabel(request.requestedMode)}
                      </Text>
                      <Text className="text-xs" style={{ color: colors.textTertiary }}>
                        {new Date(request.requestedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <View 
                      className="px-2 py-1 rounded-full"
                      style={{
                        backgroundColor: request.status === 'pending' ? colors.warningLight :
                                        request.status === 'approved' ? colors.successLight : colors.errorLight,
                      }}
                    >
                      <Text 
                        className="text-xs font-medium"
                        style={{
                          color: request.status === 'pending' ? colors.warning :
                                 request.status === 'approved' ? colors.success : colors.error,
                        }}
                      >
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </Text>
                    </View>
                  </View>
                ))}
                {myRequests.length > 2 && (
                  <Text className="text-xs mt-1" style={{ color: colors.textTertiary }}>
                    +{myRequests.length - 2} more requests
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Quick Stats */}
        <View className="rounded-2xl p-6 mt-6 shadow-sm" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-semibold" style={{ color: colors.text }}>
              Quick Stats
            </Text>
            {quickStatsLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : null}
          </View>
          {quickStatsError ? (
            <View className="items-center py-2">
              <Text className="text-sm text-center mb-2" style={{ color: colors.textSecondary }}>
                {quickStatsError}
              </Text>
              <TouchableOpacity onPress={loadQuickStats}>
                <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                  Tap to retry
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-row justify-around">
              <View className="items-center">
                <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
                  {quickStatsLoading ? '—' : quickStats.daysWorked}
                </Text>
                <Text className="text-sm" style={{ color: colors.textSecondary }}>Days Worked</Text>
              </View>
              <View className="items-center">
                <Text className="text-2xl font-bold" style={{ color: colors.success }}>
                  {quickStatsLoading ? '—' : quickStats.hoursLogged}
                </Text>
                <Text className="text-sm" style={{ color: colors.textSecondary }}>Hours Logged</Text>
              </View>
              <View className="items-center">
                <Text className="text-2xl font-bold" style={{ color: colors.primary }}>
                  {quickStatsLoading ? '—' : quickStats.thisMonth}
                </Text>
                <Text className="text-sm" style={{ color: colors.textSecondary }}>This Month</Text>
              </View>
            </View>
          )}
          {!quickStatsLoading && !quickStatsError && quickStats.daysWorked === 0 && quickStats.hoursLogged === 0 ? (
            <Text className="text-xs text-center mt-3" style={{ color: colors.textTertiary }}>
              Complete a check-in and check-out to see your stats.
            </Text>
          ) : null}
        </View>

        {/* Trademark */}
        <View style={{ paddingBottom: spacing.lg }}>
          <Trademark position="bottom" />
        </View>
        </View>
      </ScrollView>

      {/* Work Mode Request Modal */}
      <Modal
        visible={showWorkModeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWorkModeModal(false)}
      >
        <KeyboardAwareScreen
          inModal
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
          extraScrollHeight={40}
        >
          <View className="rounded-xl p-6 w-full max-w-sm" style={{ backgroundColor: colors.surface }}>
            <Text className="text-xl font-bold mb-4" style={{ color: colors.text }}>
              Request Work Mode Change
            </Text>
            
            {selectedWorkMode && (
              <View className="mb-4">
                <Text className="mb-2" style={{ color: colors.textSecondary }}>
                  Requesting: <Text className="font-medium">{getWorkModeLabel(selectedWorkMode)}</Text>
                </Text>
                <Text className="text-sm" style={{ color: colors.textTertiary }}>
                  {getAllWorkModes().find(mode => mode.value === selectedWorkMode)?.description}
                </Text>
              </View>
            )}
            
            <Text className="font-medium mb-2" style={{ color: colors.text }}>
              Reason for request:
            </Text>
            <TextInput
              className="border rounded-lg p-3 mb-4"
              placeholder="Please explain why you need this work mode change..."
              placeholderTextColor={colors.textTertiary}
              value={requestReason}
              onChangeText={setRequestReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }}
            />
            
            <View className="flex-row space-x-3">
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{ backgroundColor: colors.borderLight }}
                onPress={() => {
                  setShowWorkModeModal(false);
                  setSelectedWorkMode(null);
                  setRequestReason('');
                }}
              >
                <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{
                  backgroundColor: colors.primary,
                  opacity: submittingWorkModeRequest ? 0.7 : 1,
                }}
                disabled={submittingWorkModeRequest}
                onPress={submitWorkModeRequest}
              >
                {submittingWorkModeRequest ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-center font-medium text-white">Submit Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareScreen>
      </Modal>
    </SafeAreaView>
  );
}
