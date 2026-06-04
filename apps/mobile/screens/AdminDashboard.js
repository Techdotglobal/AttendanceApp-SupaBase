import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Image,
  TextInput,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAttendanceRecords, clearAllAttendanceRecords } from '../utils/storage';
import { exportAttendanceToCSV, shareCSVFile } from '../utils/export';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import EmployeeManagement from './EmployeeManagement';
import CalendarScreen from './CalendarScreen';
import HRDashboard from './HRDashboard';
import { getUnreadNotificationCount } from '../utils/notifications';
import { spacing, iconSize, componentSize, responsivePadding, responsiveFont, dashboardTitleFont, isSmallScreen, isTablet, normalize, getTabletGridColumns, SCREEN_WIDTH } from '../utils/responsive';
import Logo from '../components/Logo';
import Trademark from '../components/Trademark';
import HamburgerButton from '../shared/components/HamburgerButton';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../core/config/supabase';
import { MANAGER_PERMISSIONS, hasAnyPermission, hasPermission } from '../shared/constants/permissions';

export default function AdminDashboard({ route }) {
  const navigation = useNavigation();
  const { user: routeUser, initialTab, openLeaveRequests } = route.params || {};
  const { user: authUser, handleLogout } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tablet = isTablet();
  const attendanceGridColumns = getTabletGridColumns();
  const tabletContentStyle = {
    width: '100%',
    maxWidth: tablet ? Math.min(SCREEN_WIDTH - 32, 1360) : undefined,
    alignSelf: 'center',
  };
  const [employeesIsRefreshing, setEmployeesIsRefreshing] = useState(false);
  const [employeesRefreshTick, setEmployeesRefreshTick] = useState(0);
  
  // CRITICAL FIX: Role guard - prevent rendering if user is not manager/super_admin
  // Use authUser from context (most up-to-date) with fallback to route params
  const user = authUser || routeUser;
  const can = (permissionKey) => hasPermission(user, permissionKey);
  const canAny = (permissionKeys) => hasAnyPermission(user, permissionKeys);
  
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
  const resolveInitialTab = () => {
    if (initialTab) return initialTab;
    if (can(MANAGER_PERMISSIONS.VIEW_ATTENDANCE)) return 'attendance';
    if (can(MANAGER_PERMISSIONS.VIEW_EMPLOYEES)) return 'employees';
    if (canAny([MANAGER_PERMISSIONS.CREATE_EVENTS, MANAGER_PERMISSIONS.EDIT_EVENTS, MANAGER_PERMISSIONS.DELETE_EVENTS])) return 'calendar';
    if (can(MANAGER_PERMISSIONS.VIEW_HR_DASHBOARD)) return 'hr';
    return 'attendance';
  };
  const [activeTab, setActiveTab] = useState(resolveInitialTab); // 'attendance', 'employees', 'calendar', or 'hr'
  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all, checkin, checkout
  const [isExporting, setIsExporting] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [company, setCompany] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyLogoFailed, setCompanyLogoFailed] = useState(false);

  useEffect(() => {
    loadRecords();
    loadNotificationCount();
    
    // Set up interval to check notifications every 30 seconds
    const notificationInterval = setInterval(() => {
      loadNotificationCount();
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
        const tenantId = user?.companyId;
        if (!tenantId) {
          if (!isMounted) return;
          setCompany(null);
          setCompanyLoading(false);
          return;
        }
        const { data, error } = await supabase
          .from('companies')
          .select('id, name, logo_url')
          .eq('id', tenantId)
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
  }, [user?.companyId]);

  const loadRecords = async () => {
    try {
      const allRecords = await getAttendanceRecords(user?.companyId);
      
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
      const result = await exportAttendanceToCSV(user?.companyId);
      
      if (result.success) {
        await shareCSVFile(result.fileUri, result.fileName);
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

  const renderRecord = ({ item, isGridCell = false }) => {
    const { date, time } = formatDate(item.timestamp);
    
    return (
      <View 
        className="rounded-xl shadow-sm"
        style={{ 
          backgroundColor: colors.surface,
          padding: responsivePadding(16),
          marginHorizontal: isGridCell ? 0 : spacing.sm,
          marginBottom: isGridCell ? 0 : spacing.md,
          width: isGridCell ? '100%' : undefined,
          alignSelf: isGridCell ? 'stretch' : undefined,
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
            <View className="flex-row items-center" style={{ marginBottom: spacing.xs }}>
              <Text 
                className="font-semibold"
                style={{ 
                  color: colors.text,
                  fontSize: responsiveFont(18), 
                  flex: 1,
                  minWidth: 0,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {item.username}
              </Text>
              <Text 
                style={{ 
                  color: colors.textTertiary,
                  fontSize: responsiveFont(12), 
                  marginLeft: spacing.xs,
                  flexShrink: 0,
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
                    flexShrink: 1,
                    flex: 1,
                    minWidth: 0,
                  }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
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
        marginRight: tablet ? 0 : spacing.sm,
        borderRadius: 50,
        flexShrink: 0,
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

  const listBottomPadding =
    spacing.lg + insets.bottom + (tablet ? spacing['2xl'] : spacing.sm);

  const attendanceHorizontalPad = tablet ? responsivePadding(12) : 0;

  const DashboardMainCard = () => (
    <>
        {/* Main card: Welcome header, action buttons, etc. */}
        <View
          style={{
            ...tabletContentStyle,
            marginTop: responsivePadding(24),
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
            <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
                <Text
                  style={{ color: colors.text, fontSize: dashboardTitleFont(20), fontWeight: 'bold', flexShrink: 0 }}
                >
                  Welcome,{' '}
                </Text>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: dashboardTitleFont(20),
                    fontWeight: 'bold',
                    flex: 1,
                    minWidth: 0,
                  }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {user.username}!
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: tablet ? 'nowrap' : 'wrap', marginTop: spacing.xs / 2 }}>
                <Text
                  style={{ color: colors.textSecondary, fontSize: responsiveFont(12), flexShrink: tablet ? 1 : 0, minWidth: 0 }}
                  numberOfLines={tablet ? 1 : 2}
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
                paddingHorizontal: responsivePadding(24),
                paddingTop: spacing.sm,
                paddingBottom: responsivePadding(12),
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'stretch',
                  justifyContent: 'center',
                  flexWrap: 'nowrap',
                  gap: tablet ? spacing.md : spacing.xs,
                }}
              >
                {can(MANAGER_PERMISSIONS.MANUAL_ATTENDANCE) && (
                <TouchableOpacity
                  className="bg-blue-500"
                  onPress={() => navigation.navigate('ManualAttendance', { user: user })}
                  style={{ 
                    flex: tablet ? 1 : 0,
                    flexBasis: tablet ? 0 : undefined,
                    paddingHorizontal: responsivePadding(tablet ? 10 : 14),
                    paddingVertical: responsivePadding(tablet ? 10 : 6),
                    marginRight: tablet ? 0 : spacing.xs,
                    borderRadius: 50,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: tablet ? normalize(44) : undefined,
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
                      numberOfLines={1}
                    >
                      Manual
                    </Text>
                  </View>
                </TouchableOpacity>
                )}
                {can(MANAGER_PERMISSIONS.EXPORT_ATTENDANCE) && (
                <TouchableOpacity
                  className="bg-green-500"
                  onPress={handleExport}
                  disabled={isExporting || records.length === 0}
                  style={{ 
                    flex: tablet ? 1 : 0,
                    flexBasis: tablet ? 0 : undefined,
                    paddingHorizontal: responsivePadding(tablet ? 10 : 14),
                    paddingVertical: responsivePadding(tablet ? 10 : 6),
                    marginRight: tablet ? 0 : spacing.xs,
                    borderRadius: 50,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: tablet ? normalize(44) : undefined,
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
                      numberOfLines={1}
                    >
                      {isExporting ? 'Exporting...' : 'Export CSV'}
                    </Text>
                  </View>
                </TouchableOpacity>
                )}
                
                <TouchableOpacity
                  className="bg-red-500"
                  onPress={handleClearAll}
                  disabled={records.length === 0}
                  style={{ 
                    flex: tablet ? 1 : 0,
                    flexBasis: tablet ? 0 : undefined,
                    paddingHorizontal: responsivePadding(tablet ? 10 : 14),
                    paddingVertical: responsivePadding(tablet ? 10 : 6),
                    borderRadius: 50,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: tablet ? normalize(44) : undefined,
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
                      numberOfLines={1}
                    >
                      Clear All
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
    </>
  );

  const DashboardTabs = () => (
        <View
          style={{
            ...tabletContentStyle,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            width: '100%',
          }}
        >
          {can(MANAGER_PERMISSIONS.VIEW_ATTENDANCE) && (
            <TabButton title="Attendance" value="attendance" isActive={activeTab === 'attendance'} icon="time-outline" />
          )}
          {can(MANAGER_PERMISSIONS.VIEW_EMPLOYEES) && (
            <TabButton title="Employees" value="employees" isActive={activeTab === 'employees'} icon="people-outline" />
          )}
          {canAny([MANAGER_PERMISSIONS.CREATE_EVENTS, MANAGER_PERMISSIONS.EDIT_EVENTS, MANAGER_PERMISSIONS.DELETE_EVENTS]) && (
            <TabButton title="Calendar" value="calendar" isActive={activeTab === 'calendar'} icon="calendar-outline" />
          )}
          {can(MANAGER_PERMISSIONS.VIEW_HR_DASHBOARD) && (
            <TabButton title="HR" value="hr" isActive={activeTab === 'hr'} icon="briefcase-outline" />
          )}
        </View>
  );

  const AttendanceSearchFilters = () => (
        <>
            <View
              className="flex-row items-center rounded-xl"
              style={{
                ...tabletContentStyle,
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

            <View
              style={{
                ...tabletContentStyle,
                backgroundColor: colors.surface,
                borderRadius: 12,
                paddingVertical: responsivePadding(12),
                paddingHorizontal: responsivePadding(tablet ? 16 : 12),
                marginBottom: spacing.md,
              }}
            >
              {tablet ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'nowrap',
                    gap: spacing.sm,
                  }}
                >
                  <FilterButton title="All" value="all" isActive={filter === 'all'} />
                  <FilterButton title="Check In" value="checkin" isActive={filter === 'checkin'} />
                  <FilterButton title="Check Out" value="checkout" isActive={filter === 'checkout'} />
                </View>
              ) : (
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
              )}
            </View>
        </>
  );

  const AttendanceStatsCard = () => (
          <View
            className="rounded-xl shadow-sm"
            style={{
              ...tabletContentStyle,
              backgroundColor: colors.surface,
              marginVertical: spacing.md,
              padding: responsivePadding(16),
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs }}>
                <Text
                  className="font-bold"
                  style={{
                    color: colors.primary,
                    fontSize: responsiveFont(tablet ? 22 : 24),
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
                  numberOfLines={2}
                  ellipsizeMode="tail"
                  textAlign="center"
                >
                  Total Records
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs }}>
                <Text
                  className="font-bold"
                  style={{
                    color: colors.success,
                    fontSize: responsiveFont(tablet ? 22 : 24),
                  }}
                >
                  {records.filter((r) => r.type === 'checkin').length}
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                  textAlign="center"
                >
                  Check Ins
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs }}>
                <Text
                  className="font-bold"
                  style={{
                    color: colors.error,
                    fontSize: responsiveFont(tablet ? 22 : 24),
                  }}
                >
                  {records.filter((r) => r.type === 'checkout').length}
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: responsiveFont(12),
                    marginTop: spacing.xs / 2,
                  }}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                  textAlign="center"
                >
                  Check Outs
                </Text>
              </View>
            </View>
          </View>
  );

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flex: 1 }}>
        {isAttendanceTab ? (
        <FlatList
          key={`adm-att-${attendanceGridColumns}`}
          style={{ flex: 1 }}
          data={filteredRecords}
          keyExtractor={(item) => String(item.id)}
          numColumns={attendanceGridColumns}
          renderItem={({ item }) => (
            <View
              style={{
                flex: 1,
                minWidth: 0,
                paddingHorizontal: spacing.sm / 2,
                marginBottom: spacing.md,
              }}
            >
              {renderRecord({ item, isGridCell: attendanceGridColumns > 1 })}
            </View>
          )}
          columnWrapperStyle={
            attendanceGridColumns > 1
              ? {
                  flexDirection: 'row',
                  gap: spacing.sm,
                  paddingHorizontal: responsivePadding(16),
                  justifyContent: 'flex-start',
                }
              : undefined
          }
          ListHeaderComponent={
            <View style={{ width: '100%', alignSelf: 'stretch', paddingHorizontal: attendanceHorizontalPad }}>
              <DashboardMainCard />
              <DashboardTabs />
              <AttendanceSearchFilters />
              <AttendanceStatsCard />
            </View>
          }
          ListEmptyComponent={
            <View
              className="justify-center items-center"
              style={{ ...tabletContentStyle, paddingHorizontal: responsivePadding(24), paddingVertical: spacing.xl }}
            >
              <Ionicons name="people-outline" size={iconSize['4xl']} color={colors.textTertiary} />
              <Text
                className="font-semibold text-center"
                style={{
                  color: colors.textSecondary,
                  fontSize: responsiveFont(tablet ? 18 : 20),
                  marginTop: spacing.md,
                }}
              >
                {records.length === 0
                  ? 'No attendance records found'
                  : 'No records match your search'}
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
                  : 'Try adjusting your search or filter criteria'}
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
                <Text className="text-white font-semibold" style={{ fontSize: responsiveFont(16) }}>
                  Refresh
                </Text>
              </TouchableOpacity>
            </View>
          }
          ListFooterComponent={
            filteredRecords.length > 0 ? (
              <View
                className="border-t"
                style={{
                  ...tabletContentStyle,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  padding: responsivePadding(16),
                }}
              >
                <Text className="text-center" style={{ color: colors.textSecondary, fontSize: responsiveFont(14) }}>
                  Showing {filteredRecords.length} of {records.length} record{records.length !== 1 ? 's' : ''}
                </Text>
              </View>
            ) : null
          }
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: listBottomPadding,
          }}
          showsVerticalScrollIndicator={false}
        />
        ) : (
        <View style={{ flex: 1 }}>
          <DashboardMainCard />
          <DashboardTabs />
          {activeTab === 'hr' ? (
            <View className="flex-1">
              <HRDashboard navigation={navigation} route={route} />
            </View>
          ) : activeTab === 'calendar' ? (
            <View className="flex-1">
              <CalendarScreen navigation={navigation} route={route} />
            </View>
          ) : (
            <EmployeeManagement
              route={{ params: { user, openLeaveRequests } }}
              refreshTick={employeesRefreshTick}
              onReloadComplete={() => setEmployeesIsRefreshing(false)}
              refreshing={employeesIsRefreshing}
              onRefresh={onEmployeesRefresh}
            />
          )}
        </View>
        )}
      </View>

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
