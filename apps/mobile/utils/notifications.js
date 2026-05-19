// Notification Management Utilities using AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '../core/config/supabase';
import { fetchSessionUserCompanyId } from '../core/tenant/tenantScope';

const NOTIFICATIONS_KEY = 'app_notifications';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request notification permissions
 * @returns {Promise<boolean>} Whether permissions were granted
 */
export const requestNotificationPermissions = async () => {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Notification permissions not granted');
      return false;
    }
    
    // Configure Android channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
};

/**
 * CENTRALIZED NOTIFICATION CREATION HELPER
 * 
 * This is the SINGLE source of truth for creating notifications.
 * All notifications MUST be created through this function to ensure:
 * - Guaranteed persistence to AsyncStorage
 * - Consistent notification structure
 * - Proper error handling
 * - Validation of required fields
 * 
 * @param {string} recipientUsername - Username of the notification recipient (REQUIRED)
 * @param {string} title - Notification title (REQUIRED)
 * @param {string} body - Notification body (REQUIRED)
 * @param {string} type - Notification type (e.g., 'ticket_created', 'leave_request', 'leave_approved', 'leave_rejected', 'ticket_assigned', 'ticket_response', 'system')
 * @param {Object} data - Additional data to attach to notification
 * @returns {Promise<{success: boolean, notificationId?: string, error?: string}>}
 */
export const createNotification = async (recipientUsername, title, body, type = 'general', data = {}) => {
  // Validate required fields
  if (!recipientUsername || !title || !body) {
    const errorMsg = 'Missing required fields: recipientUsername, title, and body are required';
    if (__DEV__) {
      console.error('[Notification] Validation failed:', errorMsg);
    }
    return {
      success: false,
      error: errorMsg
    };
  }

  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (!tenantCid) {
      return {
        success: false,
        error: 'Tenant context missing. Please sign in again.'
      };
    }

    const { data: recipient, error: recipientError } = await supabase
      .from('users')
      .select('uid, username')
      .eq('company_id', tenantCid)
      .eq('normalized_username', recipientUsername.trim().toLowerCase())
      .maybeSingle();

    if (recipientError || !recipient?.uid) {
      return {
        success: false,
        error: recipientError?.message || 'Notification recipient not found'
      };
    }

    const { data: dbNotificationId, error: rpcError } = await supabase.rpc('create_notification', {
      p_recipient_uid: recipient.uid,
      p_recipient_username: recipient.username,
      p_title: title.trim(),
      p_body: body.trim(),
      p_type: type || 'general',
      p_data: data || {},
    });

    if (rpcError || !dbNotificationId) {
      console.error('[Notification] DB create failed:', rpcError);
      return {
        success: false,
        error: rpcError?.message || 'Failed to create notification'
      };
    }

    const notificationId = String(dbNotificationId);
    
    // Create notification object with all required fields
    const notification = {
      id: notificationId,
      recipientUsername: recipient.username,
      recipient_uid: recipient.uid,
      title: title.trim(),
      body: body.trim(),
      type: type || 'general',
      data: data || {},
      read: false,
      isRead: false, // Alias for compatibility
      createdAt: new Date().toISOString(),
    };

    if (__DEV__) {
      console.log(`[Notification] Creating notification for ${recipientUsername}:`, {
        id: notificationId,
        type,
        title: notification.title.substring(0, 50) + '...'
      });
    }

    // CRITICAL: Get all notifications and add new one
    // This must be awaited to prevent race conditions
    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    let allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    // Validate parsed data is an array
    if (!Array.isArray(allNotifications)) {
      if (__DEV__) {
        console.warn('[Notification] Invalid notifications data, resetting to empty array');
      }
      allNotifications = [];
    }
    
    // Add new notification at the beginning (newest first)
    // This ensures it's always at the top and won't be cut off
    allNotifications.unshift(notification);

    // Keep only last 1000 notifications to prevent storage bloat
    // Sort by date (newest first) to ensure proper ordering
    const sortedNotifications = allNotifications.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || 0);
      const dateB = new Date(b.createdAt || b.created_at || 0);
      return dateB - dateA; // Newest first
    });
    const limitedNotifications = sortedNotifications.slice(0, 1000);
    
    // CRITICAL: Verify the new notification is in the limited array
    // If it's not, something went wrong with sorting/limiting
    const notificationInLimited = limitedNotifications.find(n => n.id === notificationId);
    if (!notificationInLimited) {
      // This should never happen, but if it does, add it back at the top
      if (__DEV__) {
        console.warn(`[Notification] New notification ${notificationId} was cut off during limiting, adding back at top`);
      }
      limitedNotifications.unshift(notification);
      // Remove the last one to keep at 1000
      if (limitedNotifications.length > 1000) {
        limitedNotifications.pop();
      }
    }

    // CRITICAL: Write to AsyncStorage and verify success
    // This MUST complete before returning success
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(limitedNotifications));
      
      // Verify write succeeded by reading back
      // Add a small delay to ensure AsyncStorage has fully written
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const verifyJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
      if (!verifyJson) {
        throw new Error('Notification write verification failed - no data found after write');
      }
      
      const verifyNotifications = JSON.parse(verifyJson);
      if (!Array.isArray(verifyNotifications)) {
        throw new Error('Notification write verification failed - invalid data format after write');
      }
      
      const verifyFound = verifyNotifications.find(n => n && n.id === notificationId);
      
      if (!verifyFound) {
        // Last attempt: Check if notification exists with different ID format or was stored differently
        const allIds = verifyNotifications.map(n => n?.id).filter(Boolean);
        if (__DEV__) {
          console.error(`[Notification] Verification failed for ${notificationId}`);
          console.error(`[Notification] Found ${verifyNotifications.length} notifications, first 5 IDs:`, allIds.slice(0, 5));
          console.error(`[Notification] Notification object:`, JSON.stringify(notification, null, 2));
        }
        throw new Error('Notification write verification failed - notification not found after write');
      }
      
      if (__DEV__) {
        console.log(`[Notification] ✓ Successfully stored notification ${notificationId} for ${recipientUsername}`);
      }
    } catch (storageError) {
      // Storage write failed - this is critical
      const errorMsg = `Failed to persist notification to storage: ${storageError.message}`;
      console.error('[Notification] CRITICAL ERROR:', errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }

    // Send push notification if permissions granted (non-blocking)
    // This is optional - we already stored the notification
    try {
      const hasPermission = await requestNotificationPermissions();
      if (hasPermission) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: notification.title,
            body: notification.body,
            data: { ...data, notificationId, type },
            sound: true,
          },
          trigger: null, // Show immediately
        });
        
        if (__DEV__) {
          console.log(`[Notification] ✓ Push notification sent for ${notificationId}`);
        }
      }
    } catch (pushError) {
      // Push notification failure is non-critical - notification is already stored
      if (__DEV__) {
        console.warn('[Notification] Push notification failed (non-critical):', pushError.message);
      }
    }

    return {
      success: true,
      notificationId: notificationId
    };
  } catch (error) {
    const errorMsg = `Failed to create notification: ${error.message}`;
    console.error('[Notification] Error:', errorMsg);
    return {
      success: false,
      error: errorMsg
    };
  }
};

/**
 * BATCH NOTIFICATION CREATION
 * 
 * Creates notifications for multiple recipients atomically.
 * If any notification fails, it's logged but doesn't stop others.
 * 
 * @param {Array<string>} recipientUsernames - Array of usernames to notify
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {string} type - Notification type
 * @param {Object} data - Additional data
 * @returns {Promise<{success: boolean, created: number, failed: number, errors?: Array<string>}>}
 */
export const createBatchNotifications = async (recipientUsernames, title, body, type = 'general', data = {}) => {
  if (!Array.isArray(recipientUsernames) || recipientUsernames.length === 0) {
    return {
      success: false,
      created: 0,
      failed: 0,
      errors: ['No recipients provided']
    };
  }

  const results = await Promise.allSettled(
    recipientUsernames.map(username => 
      createNotification(username, title, body, type, data)
    )
  );

  const created = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - created;
  const errors = results
    .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
    .map((r, i) => {
      if (r.status === 'rejected') {
        return `Failed for ${recipientUsernames[i]}: ${r.reason?.message || 'Unknown error'}`;
      }
      return `Failed for ${recipientUsernames[i]}: ${r.value.error || 'Unknown error'}`;
    });

  if (__DEV__) {
    console.log(`[Notification] Batch creation: ${created} created, ${failed} failed`);
    if (errors.length > 0) {
      console.warn('[Notification] Batch errors:', errors);
    }
  }

  return {
    success: created > 0,
    created,
    failed,
    errors: errors.length > 0 ? errors : undefined
  };
};

/**
 * Get notifications for a user
 * @param {string} username - Username to get notifications for
 * @param {boolean} unreadOnly - Whether to return only unread notifications
 * @returns {Promise<Array>} Array of notifications
 */
export const getUserNotifications = async (username, unreadOnly = false) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (tenantCid) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('company_id', tenantCid)
        .order('created_at', { ascending: false })
        .limit(1000);
      query = authUser?.id
        ? query.eq('recipient_uid', authUser.id)
        : query.eq('recipient_username', username);

      if (unreadOnly) {
        query = query.eq('read', false);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        const dbNotifications = data.map((notif) => ({
          id: notif.id,
          recipientUsername: notif.recipient_username,
          recipient_uid: notif.recipient_uid,
          title: notif.title,
          body: notif.body,
          type: notif.type || 'general',
          data: notif.data || {},
          read: notif.read === true,
          isRead: notif.read === true,
          readAt: notif.read_at || null,
          createdAt: notif.created_at,
          updatedAt: notif.updated_at,
        }));
        await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(dbNotifications));
        return dbNotifications;
      }
      if (error) {
        console.warn('[Notification] DB read failed, falling back to cache:', error.message);
      }
    }

    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    let userNotifications = allNotifications.filter(notif => notif.recipientUsername === username);
    
    if (unreadOnly) {
      // Check both read and isRead fields for compatibility
      userNotifications = userNotifications.filter(notif => !notif.read && !notif.isRead);
    }
    
    // Sort by date (newest first)
    return userNotifications.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || 0);
      const dateB = new Date(b.createdAt || b.created_at || 0);
      return dateB - dateA;
    });
  } catch (error) {
    console.error('Error getting user notifications:', error);
    return [];
  }
};

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const markNotificationAsRead = async (notificationId) => {
  try {
    if (__DEV__) {
      console.log(`[Notification] Marking notification ${notificationId} as read`);
    }

    const { error: dbError } = await supabase
      .from('notifications')
      .update({
        read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId);
    if (dbError) {
      console.warn('[Notification] DB mark read failed, updating cache only:', dbError.message);
    }

    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    const notificationIndex = allNotifications.findIndex(notif => notif.id === notificationId);
    if (notificationIndex === -1) {
      if (__DEV__) {
        console.warn(`[Notification] Notification ${notificationId} not found`);
      }
      return {
        success: false,
        error: 'Notification not found'
      };
    }

    // Set both read and isRead for compatibility
    allNotifications[notificationIndex].read = true;
    allNotifications[notificationIndex].isRead = true;
    allNotifications[notificationIndex].readAt = new Date().toISOString();

    // CRITICAL: Persist and verify
    await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(allNotifications));
    
    // Verify write succeeded
    const verifyJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const verifyNotifications = verifyJson ? JSON.parse(verifyJson) : [];
    const verifyFound = verifyNotifications.find(n => n.id === notificationId);
    
    if (!verifyFound || !verifyFound.read || !verifyFound.isRead) {
      const errorMsg = 'Notification read state verification failed';
      if (__DEV__) {
        console.error(`[Notification] ${errorMsg}`);
      }
      return {
        success: false,
        error: errorMsg
      };
    }

    if (__DEV__) {
      console.log(`[Notification] ✓ Successfully marked notification ${notificationId} as read`);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error.message || 'Failed to mark notification as read';
    console.error('[Notification] Error marking notification as read:', errorMsg);
    return {
      success: false,
      error: errorMsg
    };
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} username - Username
 * @returns {Promise<{success: boolean, error?: string, count?: number}>}
 */
export const markAllNotificationsAsRead = async (username) => {
  try {
    if (__DEV__) {
      console.log(`[Notification] Marking all notifications as read for ${username}`);
    }

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (tenantCid) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      let query = supabase
        .from('notifications')
        .update({
          read: true,
          read_at: new Date().toISOString(),
        })
        .eq('company_id', tenantCid)
        .eq('read', false);
      query = authUser?.id
        ? query.eq('recipient_uid', authUser.id)
        : query.eq('recipient_username', username);
      const { error: dbError } = await query;
      if (dbError) {
        console.warn('[Notification] DB mark all read failed, updating cache only:', dbError.message);
      }
    }

    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    let markedCount = 0;
    const updatedNotifications = allNotifications.map(notif => {
      if (notif.recipientUsername === username && (!notif.read && !notif.isRead)) {
        markedCount++;
        return {
          ...notif,
          read: true,
          isRead: true, // Ensure both fields are set
          readAt: new Date().toISOString()
        };
      }
      return notif;
    });

    // CRITICAL: Persist and verify
    await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updatedNotifications));
    
    // Verify write succeeded - check that all user's notifications are now read
    const verifyJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const verifyNotifications = verifyJson ? JSON.parse(verifyJson) : [];
    const userUnreadCount = verifyNotifications.filter(
      n => n.recipientUsername === username && (!n.read || !n.isRead)
    ).length;
    
    if (userUnreadCount > 0) {
      const errorMsg = `Verification failed: ${userUnreadCount} unread notifications still exist`;
      if (__DEV__) {
        console.error(`[Notification] ${errorMsg}`);
      }
      return {
        success: false,
        error: errorMsg,
        count: markedCount
      };
    }

    if (__DEV__) {
      console.log(`[Notification] ✓ Successfully marked ${markedCount} notification(s) as read for ${username}`);
    }

    return { success: true, count: markedCount };
  } catch (error) {
    const errorMsg = error.message || 'Failed to mark all notifications as read';
    console.error('[Notification] Error marking all notifications as read:', errorMsg);
    return {
      success: false,
      error: errorMsg
    };
  }
};

/**
 * Get unread notification count for a user
 * @param {string} username - Username
 * @returns {Promise<number>} Count of unread notifications
 */
export const getUnreadNotificationCount = async (username) => {
  try {
    const notifications = await getUserNotifications(username, true);
    const count = notifications.length;
    
    if (__DEV__) {
      console.log(`[Notification] Unread count for ${username}: ${count}`);
    }
    
    // Ensure count is never negative
    return Math.max(0, count);
  } catch (error) {
    console.error('[Notification] Error getting unread notification count:', error);
    return 0;
  }
};

/**
 * Refresh notification count for a user
 * This is a convenience function that can be called after creating notifications
 * to ensure UI is updated immediately
 * @param {string} username - Username
 * @returns {Promise<number>} Updated unread count
 */
export const refreshNotificationCount = async (username) => {
  return await getUnreadNotificationCount(username);
};

/**
 * Delete notification
 * @param {string} notificationId - Notification ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteNotification = async (notificationId) => {
  try {
    const { error: dbError } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);
    if (dbError) {
      console.warn('[Notification] DB delete failed, updating cache only:', dbError.message);
    }

    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    const filteredNotifications = allNotifications.filter(notif => notif.id !== notificationId);

    await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(filteredNotifications));

    return { success: true };
  } catch (error) {
    console.error('Error deleting notification:', error);
    return {
      success: false,
      error: error.message || 'Failed to delete notification'
    };
  }
};

/**
 * Delete all notifications for a user
 * @param {string} username - Username
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteAllUserNotifications = async (username) => {
  try {
    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (tenantCid) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      let query = supabase
        .from('notifications')
        .delete()
        .eq('company_id', tenantCid);
      query = authUser?.id
        ? query.eq('recipient_uid', authUser.id)
        : query.eq('recipient_username', username);
      const { error: dbError } = await query;
      if (dbError) {
        console.warn('[Notification] DB delete-all failed, updating cache only:', dbError.message);
      }
    }

    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    const filteredNotifications = allNotifications.filter(notif => notif.recipientUsername !== username);

    await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(filteredNotifications));

    return { success: true };
  } catch (error) {
    console.error('Error deleting all user notifications:', error);
    return {
      success: false,
      error: error.message || 'Failed to delete all notifications'
    };
  }
};

/**
 * Clear read notifications for a user (removes only notifications where isRead === true)
 * This is different from deleteAllUserNotifications which removes ALL notifications
 * @param {string} username - Username
 * @returns {Promise<{success: boolean, error?: string, count?: number}>}
 */
export const clearReadNotifications = async (username) => {
  try {
    if (__DEV__) {
      console.log(`[Notification] Clearing read notifications for ${username}`);
    }

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    if (tenantCid) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      let query = supabase
        .from('notifications')
        .delete()
        .eq('company_id', tenantCid)
        .eq('read', true);
      query = authUser?.id
        ? query.eq('recipient_uid', authUser.id)
        : query.eq('recipient_username', username);
      const { error: dbError } = await query;
      if (dbError) {
        console.warn('[Notification] DB clear-read failed, updating cache only:', dbError.message);
      }
    }

    const notificationsJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const allNotifications = notificationsJson ? JSON.parse(notificationsJson) : [];
    
    // Count how many read notifications will be removed
    const readNotifications = allNotifications.filter(
      notif => notif.recipientUsername === username && (notif.read || notif.isRead)
    );
    const removedCount = readNotifications.length;
    
    // Keep only unread notifications and notifications for other users
    const filteredNotifications = allNotifications.filter(
      notif => !(notif.recipientUsername === username && (notif.read || notif.isRead))
    );

    // CRITICAL: Persist and verify
    await AsyncStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(filteredNotifications));
    
    // Verify write succeeded - check that no read notifications remain for this user
    const verifyJson = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
    const verifyNotifications = verifyJson ? JSON.parse(verifyJson) : [];
    const remainingReadCount = verifyNotifications.filter(
      n => n.recipientUsername === username && (n.read || n.isRead)
    ).length;
    
    if (remainingReadCount > 0) {
      const errorMsg = `Verification failed: ${remainingReadCount} read notifications still exist`;
      if (__DEV__) {
        console.error(`[Notification] ${errorMsg}`);
      }
      return {
        success: false,
        error: errorMsg,
        count: removedCount
      };
    }

    if (__DEV__) {
      console.log(`[Notification] ✓ Successfully cleared ${removedCount} read notification(s) for ${username}`);
    }

    return { success: true, count: removedCount };
  } catch (error) {
    const errorMsg = error.message || 'Failed to clear read notifications';
    console.error('[Notification] Error clearing read notifications:', errorMsg);
    return {
      success: false,
      error: errorMsg
    };
  }
};

