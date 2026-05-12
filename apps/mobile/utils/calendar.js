// Calendar and Events Management Utilities using Supabase (with AsyncStorage fallback)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core/config/supabase';
import { fetchSessionUserCompanyId, fetchCompanyUserUids } from '../core/tenant/tenantScope';
import { createNotification, createBatchNotifications } from './notifications';
import { getEmployees } from './employees';

const CALENDAR_EVENTS_KEY = 'calendar_events'; // For fallback only

/**
 * Convert database calendar event format to app format
 * @param {Object} dbEvent - Event from database
 * @returns {Object} Event in app format
 */
const convertCalendarEventFromDb = (dbEvent) => {
  // Ensure date is in YYYY-MM-DD format (Supabase DATE returns as string)
  // Handle potential timezone issues by extracting just the date part
  let dateStr = dbEvent.date;
  if (dateStr && typeof dateStr === 'string') {
    // If date includes time (shouldn't for DATE type, but handle it anyway)
    dateStr = dateStr.split('T')[0];
  } else if (dateStr instanceof Date) {
    // Convert Date object to YYYY-MM-DD string
    dateStr = dateStr.toISOString().split('T')[0];
  }

  return {
    id: dbEvent.id,
    title: dbEvent.title,
    description: dbEvent.description || '',
    date: dateStr,
    time: dbEvent.time || '',
    type: dbEvent.type,
    color: dbEvent.color || '#3b82f6',
    createdBy: dbEvent.created_by,
    createdByUid: dbEvent.created_by_uid,
    visibility: dbEvent.visibility || 'all', // 'all', 'none', 'selected'
    visibleTo: dbEvent.visible_to || dbEvent.assigned_to || [], // Array of usernames/UIDs
    assignedTo: dbEvent.assigned_to || dbEvent.visible_to || [], // Legacy field for backward compatibility
    createdAt: dbEvent.created_at,
    updatedAt: dbEvent.updated_at
  };
};

/**
 * Get event type label
 * @param {string} type - Event type
 * @returns {string} Human-readable label
 */
export const getEventTypeLabel = (type) => {
  const labels = {
    meeting: 'Meeting',
    reminder: 'Reminder',
    holiday: 'Holiday',
    other: 'Event'
  };
  return labels[type] || labels.other;
};

/**
 * Send notifications for calendar event creation/update
 * @param {Object} eventInfo - Event information
 * @returns {Promise<void>}
 */
const sendCalendarEventNotifications = async (eventInfo) => {
  const {
    eventId,
    title,
    description,
    date,
    time,
    type,
    createdBy,
    visibility,
    visibleTo = [],
    isUpdate = false
  } = eventInfo;

  try {
    // Format date and time for notification
    const eventDate = new Date(date);
    const dateStr = eventDate.toLocaleDateString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
    const timeStr = time ? ` at ${time}` : '';
    const eventTypeLabel = getEventTypeLabel(type);

    const notificationTitle = isUpdate 
      ? 'Calendar Event Updated'
      : 'New Calendar Event';
    
    const notificationBody = `${createdBy} ${isUpdate ? 'updated' : 'created'} a ${eventTypeLabel.toLowerCase()}: "${title}" on ${dateStr}${timeStr}`;

    let recipients = [];

    if (visibility === 'all') {
      // Notify all employees
      const allEmployees = await getEmployees();
      recipients = allEmployees
        .filter(emp => emp.username && emp.isActive !== false && emp.username !== createdBy)
        .map(emp => emp.username);
    } else if (visibility === 'selected') {
      // Notify only selected employees (exclude creator)
      recipients = visibleTo.filter(username => username && username !== createdBy);
    }
    // visibility === 'none' - no notifications (only creator can see, no need to notify creator)

    if (recipients.length > 0) {
      // Remove duplicates
      const uniqueRecipients = [...new Set(recipients)];

      // Create notifications
      await createBatchNotifications(
        uniqueRecipients,
        notificationTitle,
        notificationBody,
        'calendar_event',
        {
          eventId,
          eventType: type,
          date,
          time,
          createdBy,
          action: isUpdate ? 'updated' : 'created'
        }
      );

      console.log(`✓ Sent ${uniqueRecipients.length} calendar event notification(s)`);
    }
  } catch (error) {
    console.error('Error sending calendar event notifications:', error);
    throw error;
  }
};

/**
 * NOTE: Reminder Notifications
 * 
 * For scheduled reminder notifications (e.g., 10 mins before event):
 * - Would require a reminder_time field in calendar_events table
 * - Would need to use expo-notifications scheduling API
 * - Would need to respect visibility rules (only notify users who can see the event)
 * - Current implementation sends notifications on event creation/update only
 * 
 * To implement scheduled reminders:
 * 1. Add reminder_time TIME field to calendar_events table
 * 2. When creating/updating event, schedule notifications using:
 *    await Notifications.scheduleNotificationAsync({...})
 * 3. Filter recipients based on visibility before scheduling
 * 4. Cancel old scheduled notifications when event is updated/deleted
 */

/**
 * Create a calendar event (meeting, reminder, etc.)
 * @param {Object} eventData - Event data
 * @param {string} eventData.title - Event title
 * @param {string} eventData.description - Event description (optional)
 * @param {string} eventData.date - Event date (YYYY-MM-DD)
 * @param {string} eventData.time - Event time (HH:MM) (optional)
 * @param {string} eventData.type - Event type: 'meeting', 'reminder', 'holiday', 'other'
 * @param {string} eventData.createdBy - Username who created the event
 * @param {Array<string>} eventData.assignedTo - Array of employee IDs/usernames (empty = all employees)
 * @param {string} eventData.color - Event color (optional)
 * @returns {Promise<{success: boolean, eventId?: string, error?: string}>}
 */
export const createCalendarEvent = async (eventData) => {
  try {
    const {
      title,
      description = '',
      date,
      time = '',
      type = 'other',
      createdBy,
      visibility = 'all', // Extract visibility from eventData
      visibleTo = [], // Extract visibleTo from eventData
      assignedTo = [], // Legacy field for backward compatibility
      color = '#3b82f6'
    } = eventData;

    // Validate required fields
    if (!title || !date || !createdBy) {
      return {
        success: false,
        error: 'Title, date, and creator are required'
      };
    }

    // Validate visibility
    const validVisibilities = ['all', 'none', 'selected'];
    if (!validVisibilities.includes(visibility)) {
      return {
        success: false,
        error: 'Invalid visibility. Must be: all, none, or selected'
      };
    }

    // Use visibleTo if provided, otherwise fall back to assignedTo
    const finalVisibleTo = visibleTo.length > 0 ? visibleTo : assignedTo;

    // Validate selected visibility requires visibleTo
    if (visibility === 'selected' && (!finalVisibleTo || finalVisibleTo.length === 0)) {
      return {
        success: false,
        error: 'Selected visibility requires at least one employee to be selected'
      };
    }

    // Validate date format
    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) {
      return {
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      };
    }

    // Validate event type
    const validTypes = ['meeting', 'reminder', 'holiday', 'other'];
    if (!validTypes.includes(type)) {
      return {
        success: false,
        error: 'Invalid event type. Must be: meeting, reminder, holiday, or other'
      };
    }

    // Get user UID from current Supabase session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    const createdByUid = session?.user?.id || null;

    // Determine visibleTo based on visibility
    let finalVisibleToArray = [];
    if (visibility === 'all') {
      finalVisibleToArray = []; // Empty = visible to all
    } else if (visibility === 'none') {
      finalVisibleToArray = [createdBy]; // Only creator can see
    } else if (visibility === 'selected') {
      // Include creator in visibleTo if not already included
      finalVisibleToArray = [...new Set([...finalVisibleTo, createdBy])];
    }

    // Create event in Supabase
    const eventDataDb = {
      title,
      description: description || null,
      date,
      time: time || null,
      type,
      color,
      created_by: createdBy,
      created_by_uid: createdByUid,
      visibility: visibility,
      visible_to: finalVisibleToArray,
      assigned_to: finalVisibleToArray // Keep for backward compatibility
    };

    const { data, error } = await supabase
      .from('calendar_events')
      .insert(eventDataDb)
      .select()
      .single();

    if (error) {
      console.error('Error creating calendar event in Supabase:', error);
      // Fallback to AsyncStorage
      return await createCalendarEventFallback(eventData);
    }

    const eventId = data.id;
    console.log('✓ Calendar event created in Supabase:', eventId);

    // Send notifications based on visibility
    try {
      await sendCalendarEventNotifications({
        eventId,
        title,
        description,
        date,
        time,
        type,
        createdBy,
        visibility,
        visibleTo: finalVisibleToArray,
        isUpdate: false
      });
    } catch (notifError) {
      console.error('Error sending calendar event notifications:', notifError);
      // Don't fail event creation if notifications fail
    }

    return {
      success: true,
      eventId: eventId
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    // Fallback to AsyncStorage
    return await createCalendarEventFallback(eventData);
  }
};

/**
 * Fallback: Create calendar event in AsyncStorage
 */
const createCalendarEventFallback = async (eventData) => {
  try {
    const {
      title,
      description = '',
      date,
      time = '',
      type = 'other',
      createdBy,
      visibility = 'all',
      visibleTo = [],
      assignedTo = [],
      color = '#3b82f6'
    } = eventData;

    // Use visibleTo if provided, otherwise fall back to assignedTo
    const finalVisibleTo = visibleTo.length > 0 ? visibleTo : assignedTo;

    const eventId = `event_${Date.now()}_${createdBy}`;
    
    // Determine visibleTo based on visibility
    let finalVisibleToArray = [];
    if (visibility === 'all') {
      finalVisibleToArray = [];
    } else if (visibility === 'none') {
      finalVisibleToArray = [createdBy];
    } else if (visibility === 'selected') {
      finalVisibleToArray = [...new Set([...finalVisibleTo, createdBy])];
    }

    const event = {
      id: eventId,
      title,
      description,
      date,
      time,
      type,
      createdBy,
      visibility,
      visibleTo: finalVisibleToArray,
      assignedTo: finalVisibleToArray, // Legacy field
      color,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const eventsJson = await AsyncStorage.getItem(CALENDAR_EVENTS_KEY);
    const allEvents = eventsJson ? JSON.parse(eventsJson) : [];
    allEvents.push(event);

    await AsyncStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(allEvents));

    console.log('⚠️ Calendar event created in AsyncStorage (fallback):', eventId);
    return {
      success: true,
      eventId: eventId
    };
  } catch (error) {
    console.error('Error creating calendar event in AsyncStorage:', error);
    return {
      success: false,
      error: error.message || 'Failed to create calendar event'
    };
  }
};

/**
 * Get all calendar events for a user
 * @param {string} employeeId - Employee ID or username
 * @param {string} startDate - Start date filter (YYYY-MM-DD) (optional)
 * @param {string} endDate - End date filter (YYYY-MM-DD) (optional)
 * @returns {Promise<Array>} Array of calendar events
 */
export const getCalendarEvents = async (employeeId = null, startDate = null, endDate = null) => {
  try {
    // Get current user info for RLS filtering
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserUid = session?.user?.id || null;
    const currentUsername = employeeId || session?.user?.user_metadata?.username || null;

    let query = supabase
      .from('calendar_events')
      .select('*')
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    // Apply date filters
    if (startDate) {
      query = query.gte('date', startDate);
    }
    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error getting calendar events from Supabase:', error);
      // Fallback to AsyncStorage
      return await getCalendarEventsFallback(employeeId, startDate, endDate);
    }

    // Convert to app format
    let events = data.map(convertCalendarEventFromDb);

    const tenantCid = await fetchSessionUserCompanyId(supabase);
    const tenantUids = tenantCid ? await fetchCompanyUserUids(supabase, tenantCid, 'getCalendarEvents') : [];
    const tenantUidSet = new Set(tenantUids);
    if (tenantCid) {
      if (__DEV__) {
        console.log('[tenant] getCalendarEvents', { queried_company_id: tenantCid, uid_count: tenantUids.length });
      }
      events = events.filter((ev) => ev.createdByUid && tenantUidSet.has(ev.createdByUid));
    } else {
      if (__DEV__) {
        console.warn('[tenant] getCalendarEvents: no session company_id — returning no events');
      }
      events = [];
    }

    // Filter events based on visibility rules (RLS handles most, but we do additional client-side filtering)
    // Note: currentUserUid and currentUsername are already declared above (lines 367-369)
    if (currentUsername || currentUserUid) {
      events = events.filter(event => {
        // User is always creator - can see their own events
        if (event.createdBy === currentUsername || event.createdByUid === currentUserUid) {
          return true;
        }

        // Check visibility
        if (event.visibility === 'all') {
          return true; // Visible to all
        } else if (event.visibility === 'none') {
          return false; // Only creator can see
        } else if (event.visibility === 'selected') {
          // Check if user is in visibleTo array
          const visibleTo = event.visibleTo || event.assignedTo || [];
          return (
            visibleTo.includes(currentUsername) ||
            visibleTo.includes(employeeId) ||
            visibleTo.includes(currentUserUid)
          );
        }

        // Default: don't show
        return false;
      });
    }

    return events;
  } catch (error) {
    console.error('Error getting calendar events:', error);
    // Fallback to AsyncStorage
    return await getCalendarEventsFallback(employeeId, startDate, endDate);
  }
};

/**
 * Fallback: Get calendar events from AsyncStorage
 */
const getCalendarEventsFallback = async (employeeId = null, startDate = null, endDate = null) => {
  try {
    const eventsJson = await AsyncStorage.getItem(CALENDAR_EVENTS_KEY);
    const allEvents = eventsJson ? JSON.parse(eventsJson) : [];

    let filteredEvents = allEvents;
    
    if (employeeId) {
      filteredEvents = allEvents.filter(event => {
        // User is creator - can see their own events
        if (event.createdBy === employeeId) {
          return true;
        }

        // Check visibility
        if (event.visibility === 'all') {
          return true; // Visible to all
        } else if (event.visibility === 'none') {
          return false; // Only creator can see
        } else if (event.visibility === 'selected') {
          // Check if user is in visibleTo array
          const visibleTo = event.visibleTo || event.assignedTo || [];
          return visibleTo.includes(employeeId);
        }

        // Default: don't show
        return false;
      });
    }

    if (startDate || endDate) {
      filteredEvents = filteredEvents.filter(event => {
        const eventDate = event.date;
        if (startDate && eventDate < startDate) return false;
        if (endDate && eventDate > endDate) return false;
        return true;
      });
    }

    filteredEvents.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return (a.time || '').localeCompare(b.time || '');
    });

    return filteredEvents;
  } catch (error) {
    console.error('Error getting calendar events from AsyncStorage:', error);
    return [];
  }
};

/**
 * Get events for a specific date
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {string} employeeId - Employee ID or username (optional)
 * @returns {Promise<Array>} Array of events for that date
 */
export const getEventsByDate = async (date, employeeId = null) => {
  try {
    // Normalize date to YYYY-MM-DD format for comparison
    const normalizedDate = date.split('T')[0];
    
    // Fetch events for the specific date range (more efficient than fetching all)
    const events = await getCalendarEvents(employeeId, normalizedDate, normalizedDate);
    
    // Additional client-side filtering to ensure exact date match
    // This handles any edge cases with date format inconsistencies
    return events.filter(event => {
      const eventDate = event.date ? event.date.split('T')[0] : null;
      return eventDate === normalizedDate;
    });
  } catch (error) {
    console.error('Error getting events by date:', error);
    return [];
  }
};

/**
 * Update a calendar event
 * @param {string} eventId - Event ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const updateCalendarEvent = async (eventId, updates) => {
  try {
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Convert app format to db format
    if (updates.createdBy) updateData.created_by = updates.createdBy;
    if (updates.visibility) updateData.visibility = updates.visibility;
    if (updates.visibleTo) {
      updateData.visible_to = updates.visibleTo;
      updateData.assigned_to = updates.visibleTo; // Keep for backward compatibility
    } else if (updates.assignedTo) {
      updateData.visible_to = updates.assignedTo;
      updateData.assigned_to = updates.assignedTo;
    }
    if (updates.createdAt) updateData.created_at = updates.createdAt;
    
    // Remove app-format fields
    delete updateData.createdBy;
    delete updateData.visibleTo;
    delete updateData.assignedTo;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    const { error } = await supabase
      .from('calendar_events')
      .update(updateData)
      .eq('id', eventId);

    if (error) {
      console.error('Error updating calendar event in Supabase:', error);
      // Fallback to AsyncStorage
      return await updateCalendarEventFallback(eventId, updates);
    }

    // Send notifications if visibility or visibleTo changed
    if (updates.visibility !== undefined || updates.visibleTo !== undefined) {
      try {
        // Get the updated event to send notifications
        const updatedEvent = await getEventById(eventId);
        if (updatedEvent) {
          await sendCalendarEventNotifications({
            eventId: updatedEvent.id,
            title: updatedEvent.title,
            description: updatedEvent.description,
            date: updatedEvent.date,
            time: updatedEvent.time,
            type: updatedEvent.type,
            createdBy: updatedEvent.createdBy,
            visibility: updatedEvent.visibility,
            visibleTo: updatedEvent.visibleTo || updatedEvent.assignedTo || [],
            isUpdate: true
          });
        }
      } catch (notifError) {
        console.error('Error sending calendar event update notifications:', notifError);
        // Don't fail update if notifications fail
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating calendar event:', error);
    // Fallback to AsyncStorage
    return await updateCalendarEventFallback(eventId, updates);
  }
};

/**
 * Fallback: Update calendar event in AsyncStorage
 */
const updateCalendarEventFallback = async (eventId, updates) => {
  try {
    const eventsJson = await AsyncStorage.getItem(CALENDAR_EVENTS_KEY);
    const allEvents = eventsJson ? JSON.parse(eventsJson) : [];

    const eventIndex = allEvents.findIndex(event => event.id === eventId);
    if (eventIndex === -1) {
      return {
        success: false,
        error: 'Event not found'
      };
    }

    allEvents[eventIndex] = {
      ...allEvents[eventIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await AsyncStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(allEvents));

    return { success: true };
  } catch (error) {
    console.error('Error updating calendar event in AsyncStorage:', error);
    return {
      success: false,
      error: error.message || 'Failed to update calendar event'
    };
  }
};

/**
 * Delete a calendar event
 * @param {string} eventId - Event ID
 * @param {string} deletedBy - Username who deleted (for logging)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteCalendarEvent = async (eventId, deletedBy) => {
  try {
    const { error } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', eventId);

    if (error) {
      console.error('Error deleting calendar event from Supabase:', error);
      // Fallback to AsyncStorage
      return await deleteCalendarEventFallback(eventId, deletedBy);
    }

    console.log(`✓ Calendar event deleted from Supabase: ${eventId} by ${deletedBy}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    // Fallback to AsyncStorage
    return await deleteCalendarEventFallback(eventId, deletedBy);
  }
};

/**
 * Fallback: Delete calendar event from AsyncStorage
 */
const deleteCalendarEventFallback = async (eventId, deletedBy) => {
  try {
    const eventsJson = await AsyncStorage.getItem(CALENDAR_EVENTS_KEY);
    const allEvents = eventsJson ? JSON.parse(eventsJson) : [];

    const eventIndex = allEvents.findIndex(event => event.id === eventId);
    if (eventIndex === -1) {
      return {
        success: false,
        error: 'Event not found'
      };
    }

    allEvents.splice(eventIndex, 1);

    await AsyncStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(allEvents));

    console.log(`⚠️ Calendar event deleted from AsyncStorage (fallback): ${eventId} by ${deletedBy}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting calendar event from AsyncStorage:', error);
    return {
      success: false,
      error: error.message || 'Failed to delete calendar event'
    };
  }
};

/**
 * Get event by ID
 * @param {string} eventId - Event ID
 * @returns {Promise<Object|null>} Event object or null
 */
export const getEventById = async (eventId) => {
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error) {
      console.error('Error getting event by ID from Supabase:', error);
      // Fallback to AsyncStorage
      return await getEventByIdFallback(eventId);
    }

    return data ? convertCalendarEventFromDb(data) : null;
  } catch (error) {
    console.error('Error getting event by ID:', error);
    // Fallback to AsyncStorage
    return await getEventByIdFallback(eventId);
  }
};

/**
 * Fallback: Get event by ID from AsyncStorage
 */
const getEventByIdFallback = async (eventId) => {
  try {
    const eventsJson = await AsyncStorage.getItem(CALENDAR_EVENTS_KEY);
    const allEvents = eventsJson ? JSON.parse(eventsJson) : [];

    return allEvents.find(event => event.id === eventId) || null;
  } catch (error) {
    console.error('Error getting event by ID from AsyncStorage:', error);
    return null;
  }
};

/**
 * Get events grouped by date
 * @param {string} employeeId - Employee ID or username (optional)
 * @param {string} startDate - Start date (YYYY-MM-DD) (optional)
 * @param {string} endDate - End date (YYYY-MM-DD) (optional)
 * @returns {Promise<Object>} Object with dates as keys and arrays of events as values
 */
export const getEventsGroupedByDate = async (employeeId = null, startDate = null, endDate = null) => {
  try {
    const events = await getCalendarEvents(employeeId, startDate, endDate);
    const grouped = {};

    events.forEach(event => {
      if (!grouped[event.date]) {
        grouped[event.date] = [];
      }
      grouped[event.date].push(event);
    });

    return grouped;
  } catch (error) {
    console.error('Error getting events grouped by date:', error);
    return {};
  }
};

/**
 * Get event type color
 * @param {string} type - Event type
 * @returns {string} Color hex code
 */
export const getEventTypeColor = (type) => {
  const colors = {
    meeting: '#3b82f6', // blue
    reminder: '#f59e0b', // amber
    holiday: '#10b981', // green
    other: '#6b7280' // gray
  };
  return colors[type] || colors.other;
};

/**
 * Get event type icon
 * @param {string} type - Event type
 * @returns {string} Icon name
 */
export const getEventTypeIcon = (type) => {
  const icons = {
    meeting: 'people',
    reminder: 'notifications',
    holiday: 'calendar',
    other: 'calendar-outline'
  };
  return icons[type] || icons.other;
};

