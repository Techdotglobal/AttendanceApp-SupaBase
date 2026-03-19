import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Image,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAttendanceRecords, clearAllAttendanceRecords } from '../utils/storage';
import { exportAttendanceToCSV } from '../utils/export';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import EmployeeManagement from './EmployeeManagement';
import CalendarScreen from './CalendarScreen';
import HRDashboard from './HRDashboard';
import { getUnreadNotificationCount } from '../utils/notifications';
import { getPendingSignupCount } from '../utils/signupRequests';
import { fontSize, spacing, iconSize, componentSize, responsivePadding, responsiveFont, wp, isSmallScreen, normalize } from '../utils/responsive';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';
import HamburgerButton from '../shared/components/HamburgerButton';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../core/config/supabase';

export default function AdminDashboard({ route }) {
  const navigation = useNavigation();
  const { user: routeUser, initialTab, openLeaveRequests } = route.params || {};
  const { user: authUser, handleLogout } = useAuth();
  const { colors } = useTheme();
  const [employeesIsRefreshing, setEmployeesIsRefreshing] = useState(false);
  const [employeesRefreshTick, setEmployeesRefreshTick] = useState(0);
  
  // CRITICAL FIX: Role guard - prevent rendering if user is not manager/super_admin
  // Use authUser from context (most up-to-date) with fallback to route params
  const user = authUser || routeUser;
  
  // Guard: Redirect if user doesn't have manager/super_admin role
  useEffect(() => {
    if (!user || (user.role !== 'manager' && user.role !== 'super_admin')) {
      if (navigation) {
        if (user && user.role === 'employee') {
          navigation.replace('EmployeeDashboard', { user });
        } else {
          navigation.replace('LoginScreen');
        }
      }
    }
  }, [user, navigation]);
  
  // Guard: Only render if user has manager or super_admin role
  if (!user || (user.role !== 'manager' && user.role !== 'super_admin')) {
    return null;
  }
  const [activeTab, setActiveTab] = useState(initialTab || 'attendance'); // 'attendance', 'employees', 'calendar', or 'hr'
  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all, checkin, checkout
  const [isExporting, setIsExporting] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [pendingSignupCount, setPendingSignupCount] = useState(0);
  const [company, setCompany] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyLogoFailed, setCompanyLogoFailed] = useState(false);

  useEffect(() => {
    loadRecords();
    loadNotificationCount();
    loadPendingSignupCount();
    
    // Set up interval to check notifications every 30 seconds
    const notificationInterval = setInterval(() => {
      loadNotificationCount();
      loadPendingSignupCount();
    }, 30000);

    return () => {
      // Only cleanup what was actually created
      clearInterval(notificationInterval);
    };
  }, []);

  // Handle navigation params for opening leave requests
  useEffect(() => {
    if (initialTab === 'employees' && openLeaveRequests) {
      setActiveTab('employees');
    }
  }, [initialTab, openLeaveRequests]);

  useEffect(() => {
    filterRecords();
  }, [records, searchQuery, filter]);

  useEffect(() => {
    let isMounted = true;

    const fetchCompany = async () => {
      setCompanyLoading(true);
      try {
        const { data, error } = await supabase
          .from('companies')
          .select('id, name, logo_url')
          .limit(1)
          .maybeSingle();

        if (!isMounted) return;

        if (error) {
          console.error('[AdminDashboard] fetchCompany error:', error.message);
          setCompany(null);
        } else {
          setCompany(data || null);
          setCompanyLogoFailed(false);
          if (data?.logo_url) {
            console.log('[AdminDashboard] company.logo_url:', data.logo_url);
          }
        }
      } catch (e) {
        if (!isMounted) return;
        console.error('[AdminDashboard] fetchCompany error:', e?.message || e);
        setCompany(null);
      } finally {
        if (isMounted) {
          setCompanyLoading(false);
        }
      }
    };

    fetchCompany();

    return () => {
      isMounted = false;
    };
  }, []);

  const loadRecords = async () => {
    try {
      const allRecords = await getAttendanceRecords();
      
      // Sort by timestamp (newest first)
      const sortedRecords = allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRecords(sortedRecords);
    } catch (error) {
      console.error('Error loading records:', error);
      Alert.alert('Error', 'Failed to load attendance records');
    }
  };

  const loadNotificationCount = async () => {
    try {
      const count = await getUnreadNotificationCount(user.username);
      setUnreadNotificationCount(count);
    } catch (error) {
      console.error('Error loading notification count:', error);
    }
  };

  const loadPendingSignupCount = async () => {
    try {
      const count = await getPendingSignupCount();
      setPendingSignupCount(count);
    } catch (error) {
      console.error('Error loading pending signup count:', error);
    }
  };

  const filterRecords = () => {
    let filtered = records;

    // Apply type filter
    if (filter !== 'all') {
      filtered = filtered.filter(record => record.type === filter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(record => 
        record.username.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredRecords(filtered);
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadRecords();
    setIsRefreshing(false);
  };

  const onEmployeesRefresh = async () => {
    setEmployeesIsRefreshing(true);
    setEmployeesRefreshTick((t) => t + 1);
  };

  const handleExport = async () => {
    if (records.length === 0) {
      Alert.alert('No Data', 'There are no attendance records to export');
      return;
    }

    setIsExporting(true);
    try {
      const result = await exportAttendanceToCSV();
      
      if (result.success) {
        Alert.alert(
          'Export Successful',
          `CSV file has been saved to: ${result.fileName}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Export Failed', result.error || 'Failed to export data');
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Export Failed', 'An error occurred during export');
    } finally {
      setIsExporting(false);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Records',
      'Are you sure you want to delete all attendance records? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete All', 
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllAttendanceRecords();
              await loadRecords();
              Alert.alert('Success', 'All records have been cleared');
            } catch (error) {
              console.error('Error clearing records:', error);
              Alert.alert('Error', 'Failed to clear records');
            }
          }
        }
      ]
    );
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString(),
    };
  };

  const getStatusColor = (type) => {
    return type === 'checkin' ? '#10b981' : '#ef4444';
  };

  const getStatusIcon = (type) => {
    return type === 'checkin' ? 'log-in' : 'log-out';
  };

  const renderRecord = ({ item }) => {
    const { date, time } = formatDate(item.timestamp);
    
    return (
      <View 
        className="rounded-xl mb-3 shadow-sm"
        style={{ 
          backgroundColor: colors.surface,
          padding: responsivePadding(16),
          marginHorizontal: spacing.sm,
        }}
      >
        <View className="flex-row items-start">
          {/* Status Indicator */}
          <View style={{ marginRight: spacing.md }}>
            <View 
              className="rounded-full items-center justify-center"
              style={{ 
                width: componentSize.avatarMedium,
                height: componentSize.avatarMedium,
                backgroundColor: `${getStatusColor(item.type)}20` 
              }}
            >
              <Ionicons 
                name={getStatusIcon(item.type)} 
                size={iconSize.md} 
                color={getStatusColor(item.type)} 
              />
            </View>
          </View>

          {/* Record Details */}
          <View className="flex-1" style={{ flexShrink: 1 }}>
            <View className="flex-row items-center justify-between" style={{ marginBottom: spacing.xs }}>
              <Text 
                className="font-semibold"
                style={{ 
                  color: colors.text,
                  fontSize: responsiveFont(18), 
                  flexShrink: 1 
                }}
                numberOfLines={1}
              >
                {item.username}
              </Text>
              <Text 
                style={{ 
                  color: colors.textTertiary,
                  fontSize: responsiveFont(12), 
                  marginLeft: spacing.xs 
                }}
              >
                {time}
              </Text>
            </View>
            
            <View className="flex-row items-center flex-wrap" style={{ marginBottom: spacing.xs }}>
              <Text 
                style={{ 
                  color: colors.textSecondary,
                  fontSize: responsiveFont(14), 
                  marginRight: spacing.xs 
                }}
              >
                {date}
              </Text>
              <View 
                className="rounded-full"
                style={{ 
                  backgroundColor: item.type === 'checkin' ? colors.successLight : colors.errorLight,
                  paddingHorizontal: spacing.xs,
                  paddingVertical: spacing.xs / 2,
                }}
              >
                <Text 
                  className="font-medium"
                  style={{ 
                    color: item.type === 'checkin' ? colors.success : colors.error,
                    fontSize: responsiveFont(10) 
                  }}
                >
                  {item.type === 'checkin' ? 'Check In' : 'Check Out'}
                </Text>
              </View>
            </View>
            
            {/* Location */}
            {item.location && item.location.latitude !== undefined && item.location.longitude !== undefined && (
              <View className="flex-row items-center" style={{ marginBottom: spacing.xs }}>
                <Ionicons name="location-outline" size={iconSize.sm} color={colors.textSecondary} />
                <Text 
                  className="ml-1"
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12), 
                    flexShrink: 1 
                  }}
                  numberOfLines={1}
                >
                  {(item.location.latitude ?? 0).toFixed(4)}, {(item.location.longitude ?? 0).toFixed(4)}
                </Text>
              </View>
            )}

            {/* Photo */}
            {item.photo && (
              <View style={{ marginTop: spacing.xs }}>
                <Image 
                  source={{ uri: item.photo }} 
                  className="rounded-lg"
                  style={{ 
                    width: componentSize.avatarLarge,
                    height: componentSize.avatarLarge,
                  }}
                  resizeMode="cover"
                />
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const FilterButton = ({ title, value, isActive }) => (
    <TouchableOpacity
      style={{
        backgroundColor: isActive ? colors.primary : colors.borderLight,
        paddingHorizontal: responsivePadding(18),
        paddingVertical: responsivePadding(8),
        marginRight: spacing.sm,
        borderRadius: 50,
      }}
      onPress={() => setFilter(value)}
    >
      <Text 
        className="font-medium"
        style={{ 
          color: isActive ? '#ffffff' : colors.text,
          fontSize: responsiveFont(14) 
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  const TabButton = ({ title, value, isActive, icon }) => (
    <TouchableOpacity
      style={{ 
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomWidth: isActive ? 2 : 0,
        borderBottomColor: isActive ? colors.primary : 'transparent',
        paddingVertical: spacing.sm,
        minHeight: componentSize.tabBarHeight,
      }}
      onPress={() => setActiveTab(value)}
    >
      <Ionicons 
        name={icon} 
        size={iconSize.sm}
        color={isActive ? colors.primary : colors.textSecondary} 
      />
      <Text 
        className="font-medium"
        style={{ 
          color: isActive ? colors.primary : colors.textTertiary,
          fontSize: isSmallScreen() ? responsiveFont(11) : responsiveFont(12),
          marginTop: spacing.xs / 2,
          textAlign: 'center',
        }}
        numberOfLines={1}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  const isAttendanceTab = activeTab === 'attendance';
  const isEmployeesTab = activeTab === 'employees';
  const isScrollableTab = isAttendanceTab || isEmployeesTab;
  const ContentWrapper = isScrollableTab ? ScrollView : View;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }} edges={['top']}>
      {/* Main content - flex: 1 so footer stays at bottom */}
      <ContentWrapper
        style={{ flex: 1 }}
        {...(isScrollableTab
          ? {
              showsVerticalScrollIndicator: false,
              contentContainerStyle: { paddingBottom: spacing.lg },
              ...(isAttendanceTab
                ? {
                    refreshControl: (
                      <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
                    ),
                  }
                : isEmployeesTab
                  ? {
                      refreshControl: (
                        <RefreshControl
                          refreshing={employeesIsRefreshing}
                          onRefresh={onEmployeesRefresh}
                        />
                      ),
                    }
                  : {}),
            }
          : {})}
      >
      {/* Main card: Welcome header, action buttons, etc. */}
      <View
        style={{
          margin: responsivePadding(24),
          marginBottom: spacing.lg,
          backgroundColor: colors.surface,
          borderRadius: 16,
        }}
      >
        {/* Header row: Hamburger → Logo → Text. No flex/flexShrink to avoid squeezing the logo. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: responsivePadding(24),
            paddingBottom: spacing.md,
          }}
        >
          <HamburgerButton color={colors.text} size={28} style={{ marginRight: spacing.sm }} />
          {company?.logo_url && !companyLogoFailed && (
            <Image
              source={{ uri: company.logo_url }}
              style={styles.companyLogo}
              resizeMode="contain"
              onLoad={() => console.log('[AdminDashboard] Logo loaded successfully')}
              onError={(e) => {
                console.log('[AdminDashboard] Logo failed to load:', e.nativeEvent);
                setCompanyLogoFailed(true);
              }}
            />
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text
              style={{ color: colors.text, fontSize: responsiveFont(20), fontWeight: 'bold' }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Welcome, {user.username}!
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <Text
                style={{ color: colors.textSecondary, fontSize: responsiveFont(12) }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {user.role === 'super_admin' ? 'Super Admin Dashboard' :
                  user.role === 'manager' ? `${user.department || 'Department'} Manager Dashboard` :
                  'Admin Dashboard'}
              </Text>
              {user.role === 'manager' && user.department && (
                <>
                  <Text style={{ color: colors.textTertiary, marginHorizontal: spacing.xs, fontSize: responsiveFont(12) }}>•</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: responsiveFont(12) }}>{user.department}</Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Action Buttons - Functions */}
        <View 
          className="flex-row items-center justify-end"
          style={{ 
            paddingHorizontal: responsivePadding(24),
            paddingBottom: spacing.md,
          }}
        >
          <TouchableOpacity
            onPress={() => navigation.navigate('NotificationsScreen', { user: user })}
            style={{ 
              position: 'relative',
              padding: spacing.xs,
              marginRight: spacing.sm,
            }}
          >
            <Ionicons name="notifications" size={iconSize.lg} color={colors.primary} />
            {unreadNotificationCount > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  backgroundColor: colors.error,
                  borderRadius: 10,
                  minWidth: normalize(18),
                  height: normalize(18),
                  paddingHorizontal: spacing.xs / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ 
                  color: 'white', 
                  fontSize: responsiveFont(10), 
                  fontWeight: '600' 
                }}>
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
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
              marginLeft: spacing.xs,
            }}
          >
            <Ionicons name="log-out-outline" size={iconSize.lg} color={colors.error} />
          </TouchableOpacity>
          {(user.role === 'super_admin' || user.role === 'manager') && (
            <TouchableOpacity
              onPress={() => navigation.navigate('SignupApproval', { user: user })}
              style={{ 
                position: 'relative',
                padding: spacing.xs,
                marginLeft: spacing.xs,
              }}
            >
              <Ionicons name="person-add" size={iconSize.lg} color={colors.primary} />
              {pendingSignupCount > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    backgroundColor: colors.error,
                    borderRadius: 10,
                    minWidth: normalize(18),
                    height: normalize(18),
                    paddingHorizontal: spacing.xs / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ 
                    color: 'white', 
                    fontSize: responsiveFont(10), 
                    fontWeight: '600' 
                  }}>
                    {pendingSignupCount > 99 ? '99+' : pendingSignupCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate('ThemeSettingsScreen', { user: user })}
            style={{ padding: spacing.xs, marginLeft: spacing.xs }}
          >
            <Ionicons name="color-palette" size={iconSize.lg} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Action Buttons - Manual, Export CSV, Clear All */}
        {activeTab === 'attendance' && (
          <View 
            style={{ 
              paddingHorizontal: responsivePadding(12),
              paddingVertical: responsivePadding(12),
            }}
          >
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ 
                alignItems: 'center',
                justifyContent: 'center',
              }}
              style={{ maxWidth: '100%' }}
              nestedScrollEnabled={true}
            >
              <TouchableOpacity
                className="bg-blue-500"
                onPress={() => navigation.navigate('ManualAttendance', { user: user })}
                style={{ 
                  flexShrink: 0,
                  paddingHorizontal: responsivePadding(14),
                  paddingVertical: responsivePadding(6),
                  marginRight: spacing.xs,
                  borderRadius: 50,
                }}
              >
                <View className="flex-row items-center">
                  <Ionicons name="create-outline" size={iconSize.sm} color="white" />
                  <Text 
                    className="text-white font-semibold"
                    style={{ 
                      fontSize: responsiveFont(13),
                      marginLeft: spacing.xs / 2,
                    }}
                  >
                    Manual
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                className="bg-green-500"
                onPress={handleExport}
                disabled={isExporting || records.length === 0}
                style={{ 
                  flexShrink: 0,
                  paddingHorizontal: responsivePadding(14),
                  paddingVertical: responsivePadding(6),
                  marginRight: spacing.xs,
                  borderRadius: 50,
                }}
              >
                <View className="flex-row items-center">
                  <Ionicons name="download-outline" size={iconSize.sm} color="white" />
                  <Text 
                    className="text-white font-semibold"
                    style={{ 
                      fontSize: responsiveFont(13),
                      marginLeft: spacing.xs / 2,
                    }}
                  >
                    {isExporting ? 'Exporting...' : 'Export CSV'}
                  </Text>
                </View>
              </TouchableOpacity>
              
              <TouchableOpacity
                className="bg-red-500"
                onPress={handleClearAll}
                disabled={records.length === 0}
                style={{ 
                  flexShrink: 0,
                  paddingHorizontal: responsivePadding(14),
                  paddingVertical: responsivePadding(6),
                  borderRadius: 50,
                }}
              >
                <View className="flex-row items-center">
                  <Ionicons name="trash-outline" size={iconSize.sm} color="white" />
                  <Text 
                    className="text-white font-semibold"
                    style={{ 
                      fontSize: responsiveFont(13),
                      marginLeft: spacing.xs / 2,
                    }}
                  >
                    Clear All
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </View>

      {/* Tab Navigation */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            width: '100%',
          }}
        >
          <TabButton 
            title="Attendance" 
            value="attendance" 
            isActive={activeTab === 'attendance'}
            icon="time-outline"
          />
          <TabButton 
            title="Employees" 
            value="employees" 
            isActive={activeTab === 'employees'}
            icon="people-outline"
          />
          <TabButton 
            title="Calendar" 
            value="calendar" 
            isActive={activeTab === 'calendar'}
            icon="calendar-outline"
          />
          <TabButton 
            title="HR" 
            value="hr" 
            isActive={activeTab === 'hr'}
            icon="briefcase-outline"
          />
        </View>

        {/* Search Bar - Only for Attendance Tab */}
        {activeTab === 'attendance' && (
          <>
            <View 
              className="flex-row items-center rounded-xl"
              style={{
                backgroundColor: colors.borderLight,
                paddingHorizontal: responsivePadding(16),
                paddingVertical: spacing.md,
                marginBottom: spacing.md,
                marginTop: spacing.xs,
              }}
            >
              <Ionicons name="search-outline" size={iconSize.md} color={colors.textSecondary} />
              <TextInput
                className="flex-1"
                placeholder="Search by username..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={{
                  color: colors.text,
                  fontSize: responsiveFont(14),
                  marginLeft: spacing.md,
                }}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            
            {/* Filter Buttons */}
            <View 
              style={{ 
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(12),
                marginHorizontal: responsivePadding(24),
                marginBottom: spacing.md,
              }}
            >
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ 
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View className="flex-row">
                  <FilterButton title="All" value="all" isActive={filter === 'all'} />
                  <FilterButton title="Check In" value="checkin" isActive={filter === 'checkin'} />
                  <FilterButton title="Check Out" value="checkout" isActive={filter === 'checkout'} />
                </View>
              </ScrollView>
            </View>
          </>
        )}

      {/* Conditional Content */}
      {activeTab === 'hr' ? (
        <View className="flex-1">
          <HRDashboard navigation={navigation} route={route} />
        </View>
      ) : activeTab === 'calendar' ? (
        <View className="flex-1">
          <CalendarScreen navigation={navigation} route={route} />
        </View>
      ) : activeTab === 'attendance' ? (
        <>
          {/* Stats */}
          <View 
            className="rounded-xl shadow-sm"
            style={{
              backgroundColor: colors.surface,
              marginHorizontal: responsivePadding(16),
              marginVertical: spacing.md,
              padding: responsivePadding(16),
            }}
          >
            <View className="flex-row justify-around">
              <View className="items-center" style={{ flex: 1 }}>
                <Text 
                  className="font-bold"
                  style={{ 
                    color: colors.primary,
                    fontSize: responsiveFont(24) 
                  }}
                >
                  {records.length}
                </Text>
                <Text 
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                  numberOfLines={1}
                >
                  Total Records
                </Text>
              </View>
              <View className="items-center" style={{ flex: 1 }}>
                <Text 
                  className="font-bold"
                  style={{ 
                    color: colors.success,
                    fontSize: responsiveFont(24) 
                  }}
                >
                  {records.filter(r => r.type === 'checkin').length}
                </Text>
                <Text 
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                  numberOfLines={1}
                >
                  Check Ins
                </Text>
              </View>
              <View className="items-center" style={{ flex: 1 }}>
                <Text 
                  className="font-bold"
                  style={{ 
                    color: colors.error,
                    fontSize: responsiveFont(24) 
                  }}
                >
                  {records.filter(r => r.type === 'checkout').length}
                </Text>
                <Text 
                  style={{ 
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                  numberOfLines={1}
                >
                  Check Outs
                </Text>
              </View>
            </View>
          </View>

          {/* Records List */}
          {filteredRecords.length > 0 ? (
            <View style={{ padding: responsivePadding(16), paddingBottom: spacing['2xl'] }}>
              {filteredRecords.map((item) => (
                <React.Fragment key={item.id}>
                  {renderRecord({ item })}
                </React.Fragment>
              ))}
            </View>
          ) : (
            <View 
              className="justify-center items-center"
              style={{ paddingHorizontal: responsivePadding(24) }}
            >
              <Ionicons name="people-outline" size={iconSize['4xl']} color={colors.textTertiary} />
              <Text 
                className="font-semibold text-center"
                style={{ 
                  color: colors.textSecondary,
                  fontSize: responsiveFont(20),
                  marginTop: spacing.md,
                }}
              >
                {records.length === 0 
                  ? 'No attendance records found'
                  : 'No records match your search'
                }
              </Text>
              <Text 
                className="text-center"
                style={{ 
                  color: colors.textTertiary,
                  fontSize: responsiveFont(14),
                  marginTop: spacing.xs,
                }}
              >
                {records.length === 0 
                  ? 'Employees need to check in to create records'
                  : 'Try adjusting your search or filter criteria'
                }
              </Text>
              <TouchableOpacity
                className="rounded-xl"
                style={{
                  backgroundColor: colors.primary,
                  paddingHorizontal: responsivePadding(24),
                  paddingVertical: spacing.md,
                  marginTop: spacing.lg,
                }}
                onPress={onRefresh}
              >
                <Text 
                  className="text-white font-semibold"
                  style={{ fontSize: responsiveFont(16) }}
                >
                  Refresh
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Summary */}
          {filteredRecords.length > 0 && (
            <View 
              className="border-t"
              style={{ 
                backgroundColor: colors.surface,
                borderColor: colors.border,
                padding: responsivePadding(16) 
              }}
            >
              <Text 
                className="text-center"
                style={{ 
                  color: colors.textSecondary,
                  fontSize: responsiveFont(14) 
                }}
              >
                Showing {filteredRecords.length} of {records.length} record{records.length !== 1 ? 's' : ''}
              </Text>
            </View>
          )}

        </>
      ) : (
        <EmployeeManagement
          route={{ params: { user, openLeaveRequests } }}
          refreshTick={employeesRefreshTick}
          onReloadComplete={() => setEmployeesIsRefreshing(false)}
        />
      )}

      </ContentWrapper>
      {/* Footer - Logo centered above Trademark, stays at bottom via flex layout */}
      <View 
        style={{ 
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: spacing.md,
        }}
      >
        <Logo size="small" style={{ marginBottom: spacing.xs }} />
        <Trademark position="bottom" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  companyLogo: {
    height: 28,
    width: 30,
    marginLeft: 8,
  },
});
