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
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getUnreadNotificationCount } from '../utils/notifications';
import { fontSize, spacing, iconSize, componentSize, responsivePadding, responsiveFont, wp } from '../utils/responsive';
import Logo from './Logo';
import Trademark from './Trademark';

export default function CustomDrawer({ navigation, state }) {
  const { user, handleLogout } = useAuth();
  const { colors, theme } = useTheme();
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  useEffect(() => {
    loadCounts();
    const interval = setInterval(loadCounts, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadCounts = async () => {
    if (user) {
      try {
        const notifCount = await getUnreadNotificationCount(user.username);
        setUnreadNotificationCount(notifCount);
      } catch (error) {
        console.error('Error loading notification count:', error);
      }
    }
  };

  const getMenuItems = () => {
    if (!user) return [];

    const baseItems = [
      {
        name: 'Dashboard',
        icon: 'home-outline',
        screen: user.role === 'employee' ? 'EmployeeDashboard' : 'AdminDashboard',
        roles: ['employee', 'super_admin', 'manager'],
      },
    ];

    if (user.role === 'employee') {
      return [
        ...baseItems,
        {
          name: 'Attendance History',
          icon: 'time-outline',
          screen: 'AttendanceHistory',
          roles: ['employee'],
        },
        {
          name: 'Leave Requests',
          icon: 'calendar-outline',
          screen: 'LeaveRequestScreen',
          roles: ['employee'],
        },
        {
          name: 'My Tickets',
          icon: 'ticket-outline',
          screen: 'TicketScreen',
          roles: ['employee'],
        },
        {
          name: 'Calendar',
          icon: 'calendar-outline',
          screen: 'CalendarScreen',
          roles: ['employee'],
        },
        {
          name: 'Notifications',
          icon: 'notifications-outline',
          screen: 'NotificationsScreen',
          roles: ['employee'],
          badge: unreadNotificationCount,
        },
        {
          name: 'Theme Settings',
          icon: 'color-palette-outline',
          screen: 'ThemeSettingsScreen',
          roles: ['employee'],
        },
      ];
    }

    // Admin/Manager menu items
    const adminItems = [
      {
        name: 'Employee Management',
        icon: 'people-outline',
        screen: 'AdminDashboard',
        params: { initialTab: 'employees' },
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Attendance Records',
        icon: 'list-outline',
        screen: 'AdminDashboard',
        params: { initialTab: 'attendance' },
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Calendar View',
        icon: 'calendar-outline',
        screen: 'CalendarScreen',
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'HR Dashboard',
        icon: 'briefcase-outline',
        screen: 'HRDashboard',
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Ticket Management',
        icon: 'ticket-outline',
        screen: 'TicketManagement',
        roles: ['super_admin', 'manager'],
      },
      {
        name: 'Notifications',
        icon: 'notifications-outline',
        screen: 'NotificationsScreen',
        roles: ['super_admin', 'manager'],
        badge: unreadNotificationCount,
      },
    ];

    // Super Admin only items
    const superAdminItems = [
      {
        name: 'Create User',
        icon: 'person-add-outline',
        screen: 'CreateUser',
        roles: ['super_admin'],
      },
    ];

    // Manager only items
    const managerItems = [];

    return [
      ...baseItems,
      ...adminItems,
      ...(user.role === 'super_admin' ? superAdminItems : []),
      ...(user.role === 'manager' ? managerItems : []),
      {
        name: 'Theme Settings',
        icon: 'color-palette-outline',
        screen: 'ThemeSettingsScreen',
        roles: ['super_admin', 'manager'],
      },
    ];
  };

  const menuItems = getMenuItems();
  const activeRoute = state.routes[state.index]?.name;

  const handleNavigation = (item) => {
    if (item.screen) {
      if (item.params) {
        navigation.navigate(item.screen, { user, ...item.params });
      } else {
        navigation.navigate(item.screen, { user });
      }
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


