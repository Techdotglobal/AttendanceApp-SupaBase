import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  getUserNotifications, 
  markNotificationAsRead, 
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllUserNotifications,
  getUnreadNotificationCount,
  clearReadNotifications
} from '../utils/notifications';
import { useTheme } from '../contexts/ThemeContext';
import { handleNotificationNavigation } from '../utils/notificationNavigation';
import { isTablet, responsivePadding, responsiveFont, spacing } from '../shared/utils/responsive';

export default function NotificationsScreen({ navigation, route }) {
  const { user } = route.params;
  const { colors } = useTheme();
  const tablet = isTablet();
  const tabletContentStyle = {
    width: '100%',
    maxWidth: tablet ? 1000 : undefined,
    alignSelf: 'center',
  };
  const [notifications, setNotifications] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all'); // all, unread, read

  useEffect(() => {
    loadNotifications();
    
    // Safely check if navigation and addListener exist
    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('focus', () => {
          loadNotifications();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[NotificationsScreen] Failed to add navigation listener:', error);
        }
      }
    }
    
    return () => {
      // Only call unsubscribe if it's a function
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          if (__DEV__) {
            console.warn('[NotificationsScreen] Error unsubscribing navigation listener:', error);
          }
        }
      }
    };
  }, [navigation, filter]);

  const loadNotifications = async () => {
    try {
      const allNotifications = await getUserNotifications(user.username);
      const unread = await getUnreadNotificationCount(user.username);
      setUnreadCount(unread);
      
      // Apply filter - check both read and isRead for compatibility
      let filtered = allNotifications;
      if (filter === 'unread') {
        filtered = allNotifications.filter(n => !n.read && !n.isRead);
      } else if (filter === 'read') {
        filtered = allNotifications.filter(n => n.read || n.isRead);
      }
      
      setNotifications(filtered);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadNotifications();
    setIsRefreshing(false);
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      const result = await markNotificationAsRead(notificationId);
      if (result.success) {
        // Reload notifications and update badge count immediately
        await loadNotifications();
      } else {
        if (__DEV__) {
          console.warn('[NotificationsScreen] Failed to mark notification as read:', result.error);
        }
      }
    } catch (error) {
      console.error('[NotificationsScreen] Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const result = await markAllNotificationsAsRead(user.username);
      if (result.success) {
        // Reload notifications and update badge count immediately
        await loadNotifications();
        if (__DEV__) {
          console.log(`[NotificationsScreen] Marked ${result.count || 0} notification(s) as read`);
        }
        // Show success message only if notifications were actually marked
        if (result.count > 0) {
          Alert.alert('Success', `Marked ${result.count} notification${result.count !== 1 ? 's' : ''} as read`);
        }
      } else {
        Alert.alert('Error', result.error || 'Failed to mark all notifications as read');
      }
    } catch (error) {
      console.error('[NotificationsScreen] Error marking all as read:', error);
      Alert.alert('Error', 'Failed to mark all notifications as read');
    }
  };

  const handleClearRead = async () => {
    // Light confirmation - just show what will happen
    const readCount = notifications.filter(n => n.read || n.isRead).length;
    if (readCount === 0) {
      Alert.alert('Info', 'No read notifications to clear');
      return;
    }

    Alert.alert(
      'Clear Read Notifications',
      `This will remove ${readCount} read notification${readCount !== 1 ? 's' : ''}. Unread notifications will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await clearReadNotifications(user.username);
              if (result.success) {
                // Reload notifications and update badge count immediately
                await loadNotifications();
                if (__DEV__) {
                  console.log(`[NotificationsScreen] Cleared ${result.count || 0} read notification(s)`);
                }
                Alert.alert('Success', `Cleared ${result.count || 0} read notification${result.count !== 1 ? 's' : ''}`);
              } else {
                Alert.alert('Error', result.error || 'Failed to clear read notifications');
              }
            } catch (error) {
              console.error('[NotificationsScreen] Error clearing read notifications:', error);
              Alert.alert('Error', 'Failed to clear read notifications');
            }
          }
        }
      ]
    );
  };

  const handleDelete = async (notificationId) => {
    try {
      await deleteNotification(notificationId);
      await loadNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const handleDeleteAll = async () => {
    Alert.alert(
      'Delete All Notifications',
      'Are you sure you want to delete all notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAllUserNotifications(user.username);
              await loadNotifications();
              Alert.alert('Success', 'All notifications deleted');
            } catch (error) {
              console.error('Error deleting all notifications:', error);
              Alert.alert('Error', 'Failed to delete all notifications');
            }
          }
        }
      ]
    );
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'leave_request':
        return 'calendar-outline';
      case 'leave_approved':
        return 'checkmark-circle';
      case 'leave_rejected':
        return 'close-circle';
      default:
        return 'notifications-outline';
    }
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'leave_request':
        return colors.primary;
      case 'leave_approved':
        return colors.success;
      case 'leave_rejected':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleNotificationPress = async (notification) => {
    // Use centralized navigation handler
    // This ensures:
    // - Role-aware routing
    // - Safe navigation (no crashes)
    // - Proper fallbacks
    // - Notification marked as read AFTER successful navigation
    await handleNotificationNavigation(
      notification,
      navigation,
      user,
      handleMarkAsRead
    );
  };

  const renderNotification = ({ item }) => (
    <TouchableOpacity
      style={{
        backgroundColor: (item.read || item.isRead) ? colors.surface : colors.primaryLight + '20',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: getNotificationColor(item.type),
        opacity: (item.read || item.isRead) ? 0.7 : 1, // Visual distinction for read notifications
      }}
      onPress={() => handleNotificationPress(item)}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: getNotificationColor(item.type) + '20',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
          }}
        >
          <Ionicons
            name={getNotificationIcon(item.type)}
            size={20}
            color={getNotificationColor(item.type)}
          />
        </View>
        
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: (item.read || item.isRead) ? '400' : '600', color: colors.text, flex: 1 }}>
              {item.title}
            </Text>
            {!(item.read || item.isRead) && (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.primary,
                  marginLeft: 8,
                }}
              />
            )}
          </View>
          
          <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 8 }}>
            {item.body}
          </Text>
          
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>
              {formatDate(item.createdAt)}
            </Text>
            
            <TouchableOpacity
              onPress={() => handleDelete(item.id)}
              style={{ padding: 4 }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{ ...tabletContentStyle, backgroundColor: colors.surface, paddingHorizontal: tablet ? responsivePadding(24) : 16, paddingVertical: tablet ? spacing.md : 12, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ padding: 8, marginRight: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text numberOfLines={1} style={{ fontSize: tablet ? responsiveFont(22) : 20, fontWeight: 'bold', color: colors.text, flexShrink: 1 }}>
              Notifications
            </Text>
            {unreadCount > 0 && (
              <View
                style={{
                  backgroundColor: colors.error,
                  borderRadius: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  marginLeft: 8,
                }}
              >
                <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>
                  {unreadCount}
                </Text>
              </View>
            )}
          </View>
          
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'nowrap' }}>
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={handleMarkAllAsRead}
                style={{ padding: 8 }}
              >
                <Ionicons name="checkmark-done" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
            {notifications.filter(n => n.read || n.isRead).length > 0 && (
              <TouchableOpacity
                onPress={handleClearRead}
                style={{ padding: 8 }}
              >
                <Ionicons name="broom-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleDeleteAll}
              style={{ padding: 8 }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
          {['all', 'unread', 'read'].map((filterType) => (
            <TouchableOpacity
              key={filterType}
              onPress={() => setFilter(filterType)}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: filter === filterType ? colors.primary : colors.background,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: filter === filterType ? 'white' : colors.textSecondary,
                  fontWeight: filter === filterType ? '600' : '400',
                  fontSize: tablet ? responsiveFont(14) : 14,
                  textTransform: 'capitalize',
                }}
              >
                {filterType}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notifications List */}
      {notifications.length > 0 ? (
        <FlatList
          data={notifications}
          renderItem={renderNotification}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ ...tabletContentStyle, padding: tablet ? responsivePadding(20) : 16 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons name="notifications-off-outline" size={64} color={colors.textTertiary} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 16 }}>
            No notifications
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' }}>
            {filter === 'unread' 
              ? 'You have no unread notifications'
              : filter === 'read'
              ? 'You have no read notifications'
              : 'You don\'t have any notifications yet'}
          </Text>
        </View>
      )}
    </View>
  );
}

