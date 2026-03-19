import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../core/contexts/AuthContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { getPendingSignupCount } from '../../utils/signupRequests';
import { getUnreadNotificationCount } from '../../utils/notifications';
import { fontSize, spacing, iconSize, componentSize, responsivePadding, responsiveFont, wp } from '../../utils/responsive';
import { ROUTES } from '../constants/routes';
import { isHRAdmin } from '../constants/roles';
import { getOfficeLocation } from '../../features/geofencing';
import { getCurrentLocation } from '../../features/geofencing';
import { isWithin1km } from '../../features/geofencing';
import Logo from './Logo';
import Trademark from './Trademark';
import HelpButton from './HelpButton';

export default function CustomDrawer({ navigation, state }) {
  const { user, handleLogout } = useAuth();
  const { colors, theme } = useTheme();
  const [pendingSignupCount, setPendingSignupCount] = useState(0);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isEmployeeInsideRadius, setIsEmployeeInsideRadius] = useState(false);

  useEffect(() => {
    loadCounts();
    
    // Refresh when drawer opens (navigation state changes)
    // Safely check if navigation and addListener exist
    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('state', () => {
          loadCounts();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[CustomDrawer] Failed to add navigation listener:', error);
        }
      }
    } else {
      if (__DEV__) {
        console.warn('[CustomDrawer] Navigation or addListener not available');
      }
    }
    
    const interval = setInterval(loadCounts, 30000); // Update every 30 seconds
    
    // Listen for app state changes (foreground/background) - CRITICAL for notification reliability
    const { AppState } = require('react-native');
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        // App came to foreground - refresh notifications immediately
        loadCounts();
      }
    };
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      // Only call unsubscribe if it's a function
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          if (__DEV__) {
            console.warn('[CustomDrawer] Error unsubscribing navigation listener:', error);
          }
        }
      }
      clearInterval(interval);
      appStateSubscription?.remove();
    };
  }, [navigation]);

  const loadCounts = async () => {
    if (user && (user.role === 'super_admin' || user.role === 'manager')) {
      try {
        const signupCount = await getPendingSignupCount();
        setPendingSignupCount(signupCount);
      } catch (error) {
        console.error('Error loading signup count:', error);
      }
    }
    if (user) {
      try {
        const notifCount = await getUnreadNotificationCount(user.username);
        setUnreadNotificationCount(notifCount);
      } catch (error) {
        console.error('Error loading notification count:', error);
      }
    }
    // Check if employee is inside office radius
    if (user && user.role === 'employee') {
      try {
        const officeLocation = await getOfficeLocation();
        if (officeLocation) {
          const currentLocation = await getCurrentLocation();
          if (currentLocation && currentLocation.latitude && currentLocation.longitude) {
            const inside = isWithin1km(
              currentLocation.latitude,
              currentLocation.longitude,
              officeLocation.latitude,
              officeLocation.longitude
            );
            setIsEmployeeInsideRadius(inside);
          } else {
            setIsEmployeeInsideRadius(false);
          }
        } else {
          setIsEmployeeInsideRadius(false);
        }
      } catch (error) {
        console.error('Error checking employee location:', error);
        setIsEmployeeInsideRadius(false);
      }
    }
  };

  const getMenuItems = () => {
    if (!user) return [];

    const baseItems = [
      {
        name: 'Dashboard',
        icon: 'home-outline',
        screen: user.role === 'employee' ? ROUTES.EMPLOYEE_DASHBOARD : ROUTES.ADMIN_DASHBOARD,
        roles: ['employee', 'super_admin', 'manager'],
      },
    ];

    if (user.role === 'employee') {
      const employeeItems = [
        ...baseItems,
        {
          name: 'Attendance History',
          icon: 'time-outline',
          screen: ROUTES.ATTENDANCE_HISTORY,
          roles: ['employee'],
        },
        {
          name: 'Leave Requests',
          icon: 'calendar-outline',
          screen: ROUTES.LEAVE_REQUEST,
          roles: ['employee'],
        },
        {
          name: 'My Tickets',
          icon: 'ticket-outline',
          screen: ROUTES.TICKET_SCREEN,
          roles: ['employee'],
        },
        {
          name: 'Calendar',
          icon: 'calendar-outline',
          screen: ROUTES.CALENDAR,
          roles: ['employee'],
        },
        {
          name: 'Notifications',
          icon: 'notifications-outline',
          screen: ROUTES.NOTIFICATIONS,
          roles: ['employee'],
          badge: unreadNotificationCount,
        },
      ];

      // Add GeoFencing only if employee is inside office radius
      if (isEmployeeInsideRadius) {
        employeeItems.push({
          name: 'GeoFencing',
          icon: 'location-outline',
          screen: ROUTES.GEO_FENCING,
          roles: ['employee'],
          readOnly: true, // Employees can only view
        });
      }

      employeeItems.push({
        name: 'Theme Settings',
        icon: 'color-palette-outline',
        screen: ROUTES.THEME_SETTINGS,
        roles: ['employee'],
      });

      return employeeItems;
    }

    // Admin/Manager menu items
    const adminItems = [
      {
        name: 'Employee Management',
        icon: 'people-outline',
        screen: ROUTES.EMPLOYEE_MANAGEMENT,
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'HR Dashboard',
        icon: 'briefcase-outline',
        screen: ROUTES.HR_DASHBOARD,
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Ticket Management',
        icon: 'ticket-outline',
        screen: ROUTES.TICKET_MANAGEMENT,
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Manual Attendance',
        icon: 'create-outline',
        screen: ROUTES.MANUAL_ATTENDANCE,
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Calendar View',
        icon: 'calendar-outline',
        screen: ROUTES.CALENDAR,
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Notifications',
        icon: 'notifications-outline',
        screen: ROUTES.NOTIFICATIONS,
        roles: ['super_admin', 'manager'],
        badge: unreadNotificationCount,
      },
    ];

    // Super Admin only items
    const superAdminItems = [
      {
        name: 'Create User',
        icon: 'person-add-outline',
        screen: ROUTES.CREATE_USER,
        roles: ['super_admin'],
        // Also allow HR admins (checked in render logic)
      },
      {
        name: 'Delete User',
        icon: 'trash-outline',
        screen: ROUTES.DELETE_USER,
        roles: ['super_admin'],
      },
      {
        name: 'Signup Approvals',
        icon: 'checkmark-circle-outline',
        screen: ROUTES.SIGNUP_APPROVAL,
        roles: ['super_admin', 'manager'], // Managers can approve signups, including HR
        badge: pendingSignupCount,
      },
      {
        name: 'Reports',
        icon: 'document-text-outline',
        screen: 'ReportsScreen',
        roles: ['super_admin'],
      },
      {
        name: 'Attendance Settings',
        icon: 'settings-outline',
        screen: ROUTES.ATTENDANCE_SETTINGS,
        roles: ['super_admin'],
      },
      {
        name: 'Company Logo',
        icon: 'image-outline',
        screen: ROUTES.COMPANY_SETTINGS,
        roles: ['super_admin'],
      },
    ];

    // Manager only items
    const managerItems = [];

    // Filter superAdminItems: HR admins can access Create/Delete User, but not Reports
    const filteredSuperAdminItems = superAdminItems.filter(item => {
      if (item.screen === ROUTES.CREATE_USER || item.screen === ROUTES.DELETE_USER) {
        // Allow HR admins to see Create User and Delete User
        return user.role === 'super_admin' || isHRAdmin(user);
      }
      // Other super admin items (like Reports) are super_admin only
      return user.role === 'super_admin';
    });

    const adminMenuItems = [
      ...baseItems,
      ...adminItems,
      ...filteredSuperAdminItems,
      ...(user.role === 'manager' ? managerItems : []),
    ];

    // Add GeoFencing for super_admin and HR (always visible, editable)
    // Add GeoFencing for managers (always visible, read-only)
    if (user.role === 'super_admin' || isHRAdmin(user)) {
      adminMenuItems.push({
        name: 'GeoFencing',
        icon: 'location-outline',
        screen: ROUTES.GEO_FENCING,
        roles: ['super_admin', 'manager'],
        readOnly: false, // super_admin and HR can edit
      });
    } else if (user.role === 'manager') {
      adminMenuItems.push({
        name: 'GeoFencing',
        icon: 'location-outline',
        screen: ROUTES.GEO_FENCING,
        roles: ['manager'],
        readOnly: true, // Managers can only view
      });
    }

    adminMenuItems.push({
      name: 'Theme Settings',
      icon: 'color-palette-outline',
      screen: ROUTES.THEME_SETTINGS,
      roles: ['super_admin', 'manager'],
    });

    return adminMenuItems;
  };

  const menuItems = getMenuItems();
  const activeRoute = state.routes[state.index]?.name;

  const handleNavigation = (item) => {
    if (item.screen) {
      // Close drawer first
      navigation.closeDrawer();
      
      // Navigate after a small delay to ensure drawer closes smoothly
      setTimeout(() => {
        try {
          // Navigate to nested screen through MainStack
          // The drawer contains MainStack, which contains the Stack Navigator with all screens
          if (item.params) {
            navigation.navigate('MainStack', {
              screen: item.screen,
              params: { user, ...item.params }
            });
          } else {
            navigation.navigate('MainStack', {
              screen: item.screen,
              params: { user }
            });
          }
        } catch (error) {
          console.error('Navigation error:', error);
          // Alternative: Try getting the parent navigator
          try {
            const parent = navigation.getParent();
            if (parent) {
              if (item.params) {
                parent.navigate(item.screen, { user, ...item.params });
              } else {
                parent.navigate(item.screen, { user });
              }
            }
          } catch (fallbackError) {
            console.error('Fallback navigation error:', fallbackError);
          }
        }
      }, 100);
    }
  };

  const getRoleLabel = () => {
    switch (user?.role) {
      case 'super_admin':
        return 'Super Admin';
      case 'manager':
        return 'Manager';
      case 'employee':
        return 'Employee';
      default:
        return 'User';
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.primary }]}>
          <Logo size="medium" style={{ marginBottom: spacing.sm }} />
          {user && (
            <>
              <Text style={[styles.userName, { color: 'white' }]} numberOfLines={1}>
                {user.name || user.username}
              </Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{getRoleLabel()}</Text>
              </View>
              {user.department && (
                <Text style={[styles.department, { color: 'rgba(255,255,255,0.8)' }]} numberOfLines={1}>
                  {user.department}
                </Text>
              )}
            </>
          )}
        </View>

        {/* Menu Items */}
        <View style={styles.menuContainer}>
          {menuItems.map((item, index) => {
            const isActive = activeRoute === item.screen;
            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.menuItem,
                  isActive && { backgroundColor: colors.primaryLight },
                ]}
                onPress={() => handleNavigation(item)}
              >
                <View style={styles.menuItemContent}>
                  <Ionicons
                    name={item.icon}
                    size={iconSize.lg}
                    color={isActive ? colors.primary : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.menuItemText,
                      {
                        color: isActive ? colors.primary : colors.text,
                        fontSize: responsiveFont(16),
                      },
                    ]}
                  >
                    {item.name}
                  </Text>
                </View>
                {item.badge > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.error }]}>
                    <Text style={styles.badgeText}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
          
          {/* Help & Support */}
          <HelpButton 
            variant="menu" 
            navigation={navigation}
            onPress={() => navigation.closeDrawer()}
          />
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Trademark position="inline" />
        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: colors.error }]}
          onPress={() => {
            handleLogout();
            navigation.closeDrawer();
          }}
        >
          <Ionicons name="log-out-outline" size={iconSize.md} color="white" />
          <Text style={[styles.logoutText, { fontSize: responsiveFont(16) }]}>
            Logout
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: responsivePadding(24),
    paddingTop: responsivePadding(40),
    alignItems: 'center',
  },
  userName: {
    fontSize: responsiveFont(20),
    fontWeight: 'bold',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  roleBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: 12,
    marginTop: spacing.xs,
  },
  roleText: {
    color: 'white',
    fontSize: responsiveFont(12),
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  department: {
    fontSize: responsiveFont(14),
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  menuContainer: {
    padding: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.xs,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  menuItemText: {
    marginLeft: spacing.md,
    fontWeight: '500',
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: spacing.xs / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: responsiveFont(10),
    fontWeight: '600',
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: 12,
    marginTop: spacing.sm,
  },
  logoutText: {
    color: 'white',
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
});


