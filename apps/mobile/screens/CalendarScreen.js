import React, { useState, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  FlatList,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getCalendarEvents,
  getEventsByDate,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getEventTypeColor,
  getEventTypeIcon,
  getEventTypeLabel,
} from '../utils/calendar';
import { getEmployeesForCalendar, getEmployeeByUsername, getEmployeeById } from '../utils/employees';
import { useTheme } from '../contexts/ThemeContext';
import { getApprovedLeaveDates, getAllLeaveDatesWithEmployees } from '../utils/leaveManagement';
import DatePickerCalendar from '../components/DatePickerCalendar';
import { isTablet } from '../utils/responsive';

export default function CalendarScreen({ navigation, route }) {
  const { user } = route.params;
  const { colors } = useTheme();
  const tablet = isTablet();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [events, setEvents] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showEventDetailsModal, setShowEventDetailsModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [leaveDates, setLeaveDates] = useState([]); // Array of date strings for employees
  const [allLeaveDatesMap, setAllLeaveDatesMap] = useState({}); // Map of dates to leave info for admin
  const [showLeaveDetailsModal, setShowLeaveDetailsModal] = useState(false);
  const [selectedLeaveDate, setSelectedLeaveDate] = useState(null);
  const [selectedLeaveEmployees, setSelectedLeaveEmployees] = useState([]);
  
  // Event form state
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventDate, setEventDate] = useState(selectedDate);
  const [eventTime, setEventTime] = useState('');
  const [eventType, setEventType] = useState('meeting');
  const [eventVisibility, setEventVisibility] = useState('all'); // 'all', 'none', 'selected'
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [showDatePickerModal, setShowDatePickerModal] = useState(false);

  // Load data on mount and when date changes
  useEffect(() => {
    loadData();
  }, [currentDate, selectedDate]);

  // CRITICAL: Use useFocusEffect to refetch employees from Supabase when screen comes into focus
  // This ensures we always have the latest employee data (single source of truth)
  useFocusEffect(
    React.useCallback(() => {
      // Refetch employees from Supabase every time screen comes into focus
      // This ensures latest employees are available for event creation
      loadEmployees();
      
      // Also reload events to ensure consistency
      loadEvents();
    }, [user]) // Include user in dependencies to refetch when user changes
  );

  const loadData = async () => {
    await Promise.all([
      loadEvents(),
      loadEmployees(),
      loadLeaveData()
    ]);
  };

  const loadLeaveData = async () => {
    try {
      if (user.role === 'employee') {
        // For employees: get their approved leave dates
        const employee = await getEmployeeByUsername(user.username);
        if (employee) {
          const dates = await getApprovedLeaveDates(employee.id);
          setLeaveDates(dates);
        }
      } else {
        // For admin: get all leave dates with employee info
        const leaveMap = await getAllLeaveDatesWithEmployees();
        setAllLeaveDatesMap(leaveMap);
        // Also set leaveDates for highlighting
        setLeaveDates(Object.keys(leaveMap));
      }
    } catch (error) {
      console.error('Error loading leave data:', error);
    }
  };

  const loadEvents = async () => {
    try {
      const employeeId = user.username;
      // Get all events for the current month
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      
      const monthEvents = await getCalendarEvents(employeeId, startDate, endDate);
      setAllEvents(monthEvents);
      
      // Get events for selected date
      const dateEvents = await getEventsByDate(selectedDate, employeeId);
      setEvents(dateEvents);
    } catch (error) {
      console.error('Error loading events:', error);
    }
  };

  const loadEmployees = async () => {
    try {
      // Fetch employees directly from Supabase (single source of truth)
      // This ensures we get fresh data and only active employees
      const empList = await getEmployeesForCalendar(user);
      setEmployees(empList);
      
      // CRITICAL: Clean up selectedEmployees to remove any that no longer exist
      // This prevents stale references after refetch
      setSelectedEmployees(prevSelected => {
        const validUsernames = new Set(empList.map(emp => emp.username));
        return prevSelected.filter(username => validUsernames.has(username));
      });
      
      console.log(`[CalendarScreen] ✓ Loaded ${empList.length} employees from Supabase`);
    } catch (error) {
      console.error('Error loading employees:', error);
      setEmployees([]); // Set empty array on error to prevent stale data
      setSelectedEmployees([]); // Clear selected employees on error
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleCreateEvent = async () => {
    if (!eventTitle.trim() || !eventDate) {
      Alert.alert('Error', 'Please fill in title and date');
      return;
    }

    // Validate visibility selection
    if (eventVisibility === 'selected' && selectedEmployees.length === 0) {
      Alert.alert('Error', 'Please select at least one employee for "Selected Employees" visibility');
      return;
    }

    try {
      const result = await createCalendarEvent({
        title: eventTitle.trim(),
        description: eventDescription.trim(),
        date: eventDate,
        time: eventTime.trim(),
        type: eventType,
        createdBy: user.username,
        visibility: eventVisibility,
        visibleTo: eventVisibility === 'selected' ? selectedEmployees : [],
        assignedTo: eventVisibility === 'selected' ? selectedEmployees : [], // Legacy field
        color: getEventTypeColor(eventType)
      });

      if (result.success) {
        Alert.alert('Success', 'Event created successfully');
        setShowEventModal(false);
        resetEventForm();
        // CRITICAL: Refetch both events AND employees from Supabase after event creation
        // This ensures selected employees list shows latest data
        await Promise.all([
          loadEvents(),
          loadEmployees() // Refetch employees to get latest from Supabase
        ]);
      } else {
        Alert.alert('Error', result.error || 'Failed to create event');
      }
    } catch (error) {
      console.error('Error creating event:', error);
      Alert.alert('Error', 'Failed to create event');
    }
  };

  const handleDeleteEvent = async (eventId) => {
    Alert.alert(
      'Delete Event',
      'Are you sure you want to delete this event?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await deleteCalendarEvent(eventId, user.username);
              if (result.success) {
                Alert.alert('Success', 'Event deleted successfully');
                setShowEventDetailsModal(false);
                setSelectedEvent(null);
                await loadEvents();
              } else {
                Alert.alert('Error', result.error || 'Failed to delete event');
              }
            } catch (error) {
              console.error('Error deleting event:', error);
              Alert.alert('Error', 'Failed to delete event');
            }
          }
        }
      ]
    );
  };

  const resetEventForm = () => {
    setEventTitle('');
    setEventDescription('');
    setEventDate(selectedDate);
    setEventTime('');
    setEventType('meeting');
    setEventVisibility('all');
    setSelectedEmployees([]);
    setEmployeeSearchQuery('');
    setShowEmployeePicker(false);
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    
    // For admin: if date has leaves, show employee list
    if (user.role === 'admin' && allLeaveDatesMap[date] && allLeaveDatesMap[date].length > 0) {
      setSelectedLeaveDate(date);
      setSelectedLeaveEmployees(allLeaveDatesMap[date]);
      setShowLeaveDetailsModal(true);
    }
  };

  const handleMonthChange = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const toggleEmployeeSelection = (employeeUsername) => {
    if (selectedEmployees.includes(employeeUsername)) {
      setSelectedEmployees(selectedEmployees.filter(username => username !== employeeUsername));
    } else {
      // Prevent duplicates
      if (!selectedEmployees.includes(employeeUsername)) {
        setSelectedEmployees([...selectedEmployees, employeeUsername]);
      }
    }
  };

  const removeSelectedEmployee = (employeeUsername) => {
    setSelectedEmployees(selectedEmployees.filter(username => username !== employeeUsername));
  };

  const getFilteredEmployees = () => {
    if (!employeeSearchQuery.trim()) {
      return employees.filter(emp => emp.username !== user.username); // Exclude current user
    }
    const query = employeeSearchQuery.toLowerCase();
    return employees.filter(emp => 
      emp.username !== user.username && // Exclude current user
      (
        emp.name?.toLowerCase().includes(query) ||
        emp.username?.toLowerCase().includes(query) ||
        emp.email?.toLowerCase().includes(query)
      )
    );
  };

  // Calendar generation functions
  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getCalendarDays = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        day,
        date: dateString,
        isToday: dateString === new Date().toISOString().split('T')[0],
        isSelected: dateString === selectedDate,
      });
    }
    
    return days;
  };

  const getEventsForDate = (dateString) => {
    return allEvents.filter(event => event.date === dateString);
  };

  const renderCalendarDay = (dayData, index) => {
    if (!dayData) {
      return (
        <View
          key={`empty-${index}`}
          style={{
            width: '14.28%',
            aspectRatio: 1,
            padding: 4,
          }}
        />
      );
    }

    const dayEvents = getEventsForDate(dayData.date);
    const isSelected = dayData.isSelected;
    const isToday = dayData.isToday;
    const hasLeave = leaveDates.includes(dayData.date);

    return (
      <TouchableOpacity
        key={dayData.date}
        style={{
          width: '14.28%',
          aspectRatio: 1,
          padding: 4,
        }}
        onPress={() => handleDateSelect(dayData.date)}
      >
        <View
          style={{
            flex: 1,
            borderRadius: 8,
            backgroundColor: hasLeave
              ? '#fee2e2' // Light red background for leave days
              : isSelected
              ? colors.primary
              : isToday
              ? colors.primaryLight
              : colors.surface,
            borderWidth: hasLeave ? 2 : (isToday ? 2 : 0),
            borderColor: hasLeave ? '#ef4444' : colors.primary, // Red border for leave days
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: isSelected || isToday || hasLeave ? 'bold' : 'normal',
              color: hasLeave
                ? '#ef4444' // Red text for leave days
                : isSelected
                ? '#fff'
                : colors.text,
              marginBottom: 2,
            }}
          >
            {dayData.day}
          </Text>
          {hasLeave && (
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: '#ef4444',
                marginTop: 2,
              }}
            />
          )}
          {!hasLeave && dayEvents.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
              {dayEvents.slice(0, 3).map((event, idx) => (
                <View
                  key={idx}
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: event.color || getEventTypeColor(event.type),
                    marginHorizontal: 1,
                  }}
                />
              ))}
              {dayEvents.length > 3 && (
                <Text
                  style={{
                    fontSize: 8,
                    color: isSelected ? '#fff' : colors.textSecondary,
                  }}
                >
                  +{dayEvents.length - 3}
                </Text>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEvent = ({ item }) => (
    <TouchableOpacity
      style={{
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
      }}
      onPress={() => {
        setSelectedEvent(item);
        setShowEventDetailsModal(true);
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          style={{
            width: 4,
            height: '100%',
            borderRadius: 2,
            backgroundColor: item.color || getEventTypeColor(item.type),
            marginRight: 12,
          }}
        />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text
              style={{
                fontSize: 18,
                fontWeight: '600',
                color: colors.text,
              }}
            >
              {item.title}
            </Text>
            <Ionicons
              name={getEventTypeIcon(item.type)}
              size={18}
              color={getEventTypeColor(item.type)}
            />
          </View>
          {item.description && (
            <Text
              style={{
                fontSize: 14,
                color: colors.textSecondary,
                marginBottom: 8,
              }}
            >
              {item.description}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            {item.time && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
                <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginLeft: 4,
                  }}
                >
                  {item.time}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} />
              <Text
                style={{
                  fontSize: 12,
                  color: colors.textSecondary,
                  marginLeft: 4,
                  textTransform: 'capitalize',
                }}
              >
                {getEventTypeLabel(item.type)}
              </Text>
            </View>
          </View>
          {/* Visibility Info */}
          {item.visibility === 'all' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Ionicons name="people" size={12} color={colors.textTertiary} />
              <Text
                style={{
                  fontSize: 11,
                  color: colors.textTertiary,
                  marginLeft: 4,
                }}
              >
                Visible to all employees
              </Text>
            </View>
          )}
          {item.visibility === 'none' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />
              <Text
                style={{
                  fontSize: 11,
                  color: colors.textTertiary,
                  marginLeft: 4,
                }}
              >
                Private (only visible to creator)
              </Text>
            </View>
          )}
          {item.visibility === 'selected' && (item.visibleTo || item.assignedTo) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Ionicons name="person" size={12} color={colors.textTertiary} />
              <Text
                style={{
                  fontSize: 11,
                  color: colors.textTertiary,
                  marginLeft: 4,
                }}
              >
                Visible to {(item.visibleTo || item.assignedTo || []).length} selected employee{((item.visibleTo || item.assignedTo || []).length) !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatMonthYear = (date) => {
    return date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  };

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calendarDays = getCalendarDays();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: colors.surface,
          paddingHorizontal: 16,
          paddingVertical: 12,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            style={{
              fontSize: 20,
              fontWeight: 'bold',
              color: colors.text,
            }}
          >
            Calendar
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
            onPress={() => {
              resetEventForm();
              setShowEventModal(true);
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="add" size={18} color="white" />
              <Text
                style={{
                  color: 'white',
                  fontWeight: '600',
                  marginLeft: 4,
                }}
              >
                New Event
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {/* Month Navigation */}
        <View
          style={{
            backgroundColor: colors.surface,
            margin: 16,
            borderRadius: 16,
            padding: 16,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <TouchableOpacity
              onPress={() => handleMonthChange(-1)}
              style={{ padding: 8 }}
            >
              <Ionicons name="chevron-back" size={24} color={colors.primary} />
            </TouchableOpacity>

            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: '600',
                  color: colors.text,
                }}
              >
                {formatMonthYear(currentDate)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => handleMonthChange(1)}
              style={{ padding: 8 }}
            >
              <Ionicons name="chevron-forward" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: colors.primaryLight,
              borderRadius: 8,
              padding: 8,
              marginBottom: 16,
            }}
            onPress={() => {
              const today = new Date().toISOString().split('T')[0];
              setSelectedDate(today);
              setCurrentDate(new Date());
            }}
          >
            <Text
              style={{
                color: colors.primary,
                textAlign: 'center',
                fontWeight: '500',
              }}
            >
              Go to Today
            </Text>
          </TouchableOpacity>

          {/* Week Day Headers */}
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            {weekDays.map((day) => (
              <View
                key={day}
                style={{
                  width: '14.28%',
                  alignItems: 'center',
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: colors.textSecondary,
                  }}
                >
                  {day}
                </Text>
              </View>
            ))}
          </View>

          {/* Calendar Grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {calendarDays.map((day, index) => renderCalendarDay(day, index))}
          </View>
        </View>

        {/* Selected Date Events */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '600',
              color: colors.text,
              marginBottom: 12,
            }}
          >
            {formatDate(selectedDate)} - {events.length} event{events.length !== 1 ? 's' : ''}
          </Text>

          {events.length > 0 ? (
            <FlatList
              data={events}
              renderItem={renderEvent}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          ) : (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 32,
                alignItems: 'center',
              }}
            >
              <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
              <Text
                style={{
                  color: colors.textSecondary,
                  marginTop: 16,
                  textAlign: 'center',
                }}
              >
                No events for this date
              </Text>
              <Text
                style={{
                  color: colors.textTertiary,
                  fontSize: 12,
                  marginTop: 8,
                  textAlign: 'center',
                }}
              >
                Tap "New Event" to create one
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* New Event Modal */}
      <Modal
        visible={showEventModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEventModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View
            style={{
              flex: 1,
              justifyContent: tablet ? 'center' : 'flex-end',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
            }}
          >
            <View
              style={{
                backgroundColor: colors.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderBottomLeftRadius: tablet ? 24 : 0,
                borderBottomRightRadius: tablet ? 24 : 0,
                padding: 24,
                maxHeight: tablet ? '85%' : '80%',
                width: '100%',
                maxWidth: tablet ? 700 : undefined,
                alignSelf: 'center',
              }}
            >
              <ScrollView 
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: 'bold',
                    color: colors.text,
                  }}
                >
                  New Event
                </Text>
                <TouchableOpacity onPress={() => setShowEventModal(false)}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Title */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, marginBottom: 8, fontWeight: '500' }}>Title *</Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    color: colors.text,
                  }}
                  placeholder="Enter event title"
                  placeholderTextColor={colors.textTertiary}
                  value={eventTitle}
                  onChangeText={setEventTitle}
                />
              </View>

              {/* Description */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, marginBottom: 8, fontWeight: '500' }}>Description</Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    color: colors.text,
                    minHeight: 80,
                    textAlignVertical: 'top',
                  }}
                  placeholder="Enter event description"
                  placeholderTextColor={colors.textTertiary}
                  value={eventDescription}
                  onChangeText={setEventDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Date */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, marginBottom: 8, fontWeight: '500' }}>Date *</Text>
                <TouchableOpacity
                  onPress={() => setShowDatePickerModal(true)}
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <TextInput
                      style={{
                        flex: 1,
                        color: colors.text,
                        fontSize: 16,
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textTertiary}
                      value={eventDate}
                      onChangeText={setEventDate}
                      editable={true}
                      onFocus={() => setShowDatePickerModal(true)}
                    />
                    <Ionicons name="calendar-outline" size={20} color={colors.primary} style={{ marginLeft: 8 }} />
                  </View>
                </TouchableOpacity>
                <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>
                  Tap to select date or type manually (Format: YYYY-MM-DD)
                </Text>
              </View>

              {/* Time */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, marginBottom: 8, fontWeight: '500' }}>Time (Optional)</Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    color: colors.text,
                  }}
                  placeholder="HH:MM (e.g., 14:30)"
                  placeholderTextColor={colors.textTertiary}
                  value={eventTime}
                  onChangeText={setEventTime}
                />
                <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 4 }}>
                  Format: HH:MM (24-hour format)
                </Text>
              </View>

              {/* Event Type */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, marginBottom: 8, fontWeight: '500' }}>Event Type</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['meeting', 'reminder', 'holiday', 'other'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={{
                        borderRadius: 8,
                        padding: 12,
                        borderWidth: 2,
                        borderColor: eventType === type ? colors.primary : colors.border,
                        backgroundColor: eventType === type ? colors.primaryLight : 'transparent',
                        minWidth: '22%',
                      }}
                      onPress={() => setEventType(type)}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 12,
                          fontWeight: '500',
                          color: eventType === type ? colors.primary : colors.text,
                        }}
                      >
                        {getEventTypeLabel(type)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Visibility Selector */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: colors.text, marginBottom: 8, fontWeight: '500' }}>
                  Visibility *
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    { value: 'all', label: 'All', icon: 'people', description: 'Visible to all employees' },
                    { value: 'none', label: 'None', icon: 'lock-closed', description: 'Only visible to me' },
                    { value: 'selected', label: 'Selected', icon: 'person', description: 'Selected employees only' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={{
                        flex: 1,
                        minWidth: '30%',
                        borderRadius: 12,
                        padding: 12,
                        borderWidth: 2,
                        borderColor: eventVisibility === option.value ? colors.primary : colors.border,
                        backgroundColor: eventVisibility === option.value ? colors.primaryLight : colors.background,
                        alignItems: 'center',
                      }}
                      onPress={() => {
                        setEventVisibility(option.value);
                        if (option.value !== 'selected') {
                          setSelectedEmployees([]);
                          setShowEmployeePicker(false);
                        }
                      }}
                    >
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={eventVisibility === option.value ? colors.primary : colors.textSecondary}
                        style={{ marginBottom: 4 }}
                      />
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 12,
                          fontWeight: '600',
                          color: eventVisibility === option.value ? colors.primary : colors.text,
                          marginBottom: 2,
                        }}
                      >
                        {option.label}
                      </Text>
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 10,
                          color: eventVisibility === option.value ? colors.textSecondary : colors.textTertiary,
                        }}
                        numberOfLines={2}
                      >
                        {option.description}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Selected Employees Picker (only shown when visibility = 'selected') */}
              {eventVisibility === 'selected' && (
                <View style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: colors.text, fontWeight: '500' }}>
                      Select Employees *
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowEmployeePicker(!showEmployeePicker)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 4,
                      }}
                    >
                      <Text style={{ color: colors.primary, fontSize: 12, marginRight: 4 }}>
                        {showEmployeePicker ? 'Hide' : 'Show'} List
                      </Text>
                      <Ionicons
                        name={showEmployeePicker ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.primary}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Selected Employees Chips */}
                  {selectedEmployees.length > 0 && (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        marginBottom: 8,
                        minHeight: 40,
                      }}
                    >
                      {selectedEmployees.map((username) => {
                        const emp = employees.find(e => e.username === username);
                        return (
                          <View
                            key={username}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              backgroundColor: colors.primaryLight,
                              borderRadius: 16,
                              paddingHorizontal: 12,
                              paddingVertical: 6,
                              marginRight: 8,
                              marginBottom: 8,
                              maxWidth: '100%',
                            }}
                          >
                            <Text
                              numberOfLines={1}
                              ellipsizeMode="tail"
                              style={{
                                color: colors.primary,
                                fontSize: 12,
                                fontWeight: '500',
                                marginRight: 6,
                                flexShrink: 1,
                              }}
                            >
                              {emp?.name || username}
                            </Text>
                            <TouchableOpacity
                              onPress={() => removeSelectedEmployee(username)}
                              style={{ padding: 2 }}
                            >
                              <Ionicons name="close-circle" size={16} color={colors.primary} />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Employee Search and List */}
                  {showEmployeePicker && (
                    <View
                      style={{
                        backgroundColor: colors.background,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: colors.border,
                        maxHeight: 200,
                      }}
                    >
                      {/* Search Bar */}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: colors.surface,
                          borderRadius: 8,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          margin: 8,
                        }}
                      >
                        <Ionicons name="search" size={18} color={colors.textSecondary} />
                        <TextInput
                          style={{
                            flex: 1,
                            marginLeft: 8,
                            color: colors.text,
                            fontSize: 14,
                          }}
                          placeholder="Search by name, username, or email..."
                          placeholderTextColor={colors.textTertiary}
                          value={employeeSearchQuery}
                          onChangeText={setEmployeeSearchQuery}
                        />
                        {employeeSearchQuery.length > 0 && (
                          <TouchableOpacity onPress={() => setEmployeeSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Employee List */}
                      <ScrollView
                        style={{ maxHeight: 150 }}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        {getFilteredEmployees().length > 0 ? (
                          getFilteredEmployees().map((emp) => {
                            const isSelected = selectedEmployees.includes(emp.username);
                            return (
                              <TouchableOpacity
                                key={emp.id || emp.username}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  padding: 12,
                                  borderBottomWidth: 1,
                                  borderBottomColor: colors.border,
                                }}
                                onPress={() => toggleEmployeeSelection(emp.username)}
                              >
                                <Ionicons
                                  name={isSelected ? 'checkbox' : 'square-outline'}
                                  size={20}
                                  color={isSelected ? colors.primary : colors.textSecondary}
                                  style={{ marginRight: 12 }}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={{
                                      color: colors.text,
                                      fontSize: 14,
                                      fontWeight: '500',
                                    }}
                                  >
                                    {emp.name || emp.username}
                                  </Text>
                                  {emp.username && emp.username !== emp.name && (
                                    <Text
                                      style={{
                                        color: colors.textSecondary,
                                        fontSize: 12,
                                        marginTop: 2,
                                      }}
                                    >
                                      @{emp.username}
                                    </Text>
                                  )}
                                  {emp.email && (
                                    <Text
                                      style={{
                                        color: colors.textTertiary,
                                        fontSize: 11,
                                        marginTop: 2,
                                      }}
                                      numberOfLines={1}
                                    >
                                      {emp.email}
                                    </Text>
                                  )}
                                </View>
                              </TouchableOpacity>
                            );
                          })
                        ) : (
                          <View style={{ padding: 16, alignItems: 'center' }}>
                            <Text style={{ color: colors.textTertiary, fontSize: 14 }}>
                              {employeeSearchQuery ? 'No employees found' : 'No employees available'}
                            </Text>
                          </View>
                        )}
                      </ScrollView>
                    </View>
                  )}

                  {selectedEmployees.length === 0 && (
                    <Text style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>
                      Please select at least one employee
                    </Text>
                  )}
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                <TouchableOpacity
                  style={{
                    backgroundColor: colors.border,
                    borderRadius: 8,
                    padding: 12,
                    flex: 1,
                  }}
                  onPress={() => setShowEventModal(false)}
                >
                  <Text style={{ textAlign: 'center', fontWeight: '500', color: colors.text }}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 8,
                    padding: 12,
                    flex: 1,
                  }}
                  onPress={handleCreateEvent}
                >
                  <Text style={{ textAlign: 'center', fontWeight: '500', color: 'white' }}>
                    Create Event
                  </Text>
                </TouchableOpacity>
              </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Leave Details Modal (Admin only) */}
      {user.role === 'admin' && (
        <Modal
          visible={showLeaveDetailsModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowLeaveDetailsModal(false)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: tablet ? 'center' : 'flex-end',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
            }}
          >
            <View
              style={{
                backgroundColor: colors.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderBottomLeftRadius: tablet ? 24 : 0,
                borderBottomRightRadius: tablet ? 24 : 0,
                padding: 24,
                maxHeight: tablet ? '80%' : '70%',
                width: '100%',
                maxWidth: tablet ? 700 : undefined,
                alignSelf: 'center',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 20,
                      fontWeight: 'bold',
                      color: colors.text,
                    }}
                  >
                    Employees on Leave
                  </Text>
                  {selectedLeaveDate && (
                    <Text
                      style={{
                        fontSize: 14,
                        color: colors.textSecondary,
                        marginTop: 4,
                      }}
                    >
                      {formatDate(selectedLeaveDate)}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setShowLeaveDetailsModal(false)}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {selectedLeaveEmployees && selectedLeaveEmployees.length > 0 ? (
                <FlatList
                  data={selectedLeaveEmployees}
                  keyExtractor={(item, index) => `${item.employeeId}-${index}`}
                  renderItem={({ item }) => (
                    <View
                      style={{
                        backgroundColor: colors.background,
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 12,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: '600',
                          color: colors.text,
                          marginBottom: 8,
                        }}
                      >
                        {item.employeeName}
                      </Text>
                      <View style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                          <Text
                            style={{
                              fontSize: 12,
                              color: colors.textSecondary,
                              marginLeft: 6,
                              textTransform: 'capitalize',
                            }}
                          >
                            {item.leaveType} Leave
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                          <Text
                            style={{
                              fontSize: 12,
                              color: colors.textSecondary,
                              marginLeft: 6,
                            }}
                          >
                            {item.startDate}{item.startDate !== item.endDate ? ` to ${item.endDate}` : ''} ({item.isHalfDay ? 'Half day' : `${item.days} day${item.days !== 1 ? 's' : ''}`})
                            {item.isHalfDay && ` - ${item.halfDayPeriod === 'morning' ? 'Morning' : 'Afternoon'}`}
                          </Text>
                        </View>
                        {item.reason && (
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 }}>
                            <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
                            <Text
                              style={{
                                fontSize: 12,
                                color: colors.textSecondary,
                                marginLeft: 6,
                                flex: 1,
                              }}
                            >
                              {item.reason}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                  style={{ maxHeight: 400 }}
                />
              ) : (
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
                  <Text
                    style={{
                      color: colors.textSecondary,
                      marginTop: 16,
                      textAlign: 'center',
                    }}
                  >
                    No employees on leave for this date
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={{
                  backgroundColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 16,
                }}
                onPress={() => setShowLeaveDetailsModal(false)}
              >
                <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '500' }}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Event Details Modal */}
      <Modal
        visible={showEventDetailsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEventDetailsModal(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: tablet ? 'center' : 'flex-end',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderBottomLeftRadius: tablet ? 24 : 0,
              borderBottomRightRadius: tablet ? 24 : 0,
              padding: 24,
              maxHeight: tablet ? '80%' : '60%',
              width: '100%',
              maxWidth: tablet ? 700 : undefined,
              alignSelf: 'center',
            }}
          >
            {selectedEvent && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        fontSize: 20,
                        fontWeight: 'bold',
                        color: colors.text,
                      }}
                    >
                      {selectedEvent.title}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Ionicons
                        name={getEventTypeIcon(selectedEvent.type)}
                        size={16}
                        color={getEventTypeColor(selectedEvent.type)}
                      />
                      <Text
                        style={{
                          fontSize: 14,
                          marginLeft: 4,
                          textTransform: 'capitalize',
                          color: getEventTypeColor(selectedEvent.type),
                        }}
                      >
                        {getEventTypeLabel(selectedEvent.type)}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setShowEventDetailsModal(false)}>
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {selectedEvent.description && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ color: colors.textSecondary }}>{selectedEvent.description}</Text>
                  </View>
                )}

                <View style={{ gap: 8, marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                    <Text style={{ color: colors.text, marginLeft: 8 }}>
                      {formatDate(selectedEvent.date)}
                    </Text>
                  </View>
                  {selectedEvent.time && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                      <Text style={{ color: colors.text, marginLeft: 8 }}>{selectedEvent.time}</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                    <Text style={{ color: colors.text, marginLeft: 8 }}>
                      Created by {selectedEvent.createdBy}
                    </Text>
                  </View>
                  {/* Visibility Info */}
                  {selectedEvent.visibility === 'all' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
                      <Text style={{ color: colors.text, marginLeft: 8 }}>
                        Visible to all employees
                      </Text>
                    </View>
                  )}
                  {selectedEvent.visibility === 'none' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
                      <Text style={{ color: colors.text, marginLeft: 8 }}>
                        Private (only visible to creator)
                      </Text>
                    </View>
                  )}
                  {selectedEvent.visibility === 'selected' && (selectedEvent.visibleTo || selectedEvent.assignedTo) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                      <Text style={{ color: colors.text, marginLeft: 8 }}>
                        Visible to {(selectedEvent.visibleTo || selectedEvent.assignedTo || []).length} selected employee{((selectedEvent.visibleTo || selectedEvent.assignedTo || []).length) !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                </View>

                {(selectedEvent.createdBy === user.username || user.role === 'admin') && (
                  <TouchableOpacity
                    style={{
                      backgroundColor: colors.error,
                      borderRadius: 8,
                      padding: 12,
                      marginTop: 16,
                    }}
                    onPress={() => handleDeleteEvent(selectedEvent.id)}
                  >
                    <Text style={{ color: 'white', textAlign: 'center', fontWeight: '500' }}>
                      Delete Event
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.border,
                    borderRadius: 8,
                    padding: 12,
                    marginTop: 8,
                  }}
                  onPress={() => setShowEventDetailsModal(false)}
                >
                  <Text style={{ color: colors.text, textAlign: 'center', fontWeight: '500' }}>
                    Close
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      <Modal
        visible={showDatePickerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDatePickerModal(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: tablet ? 'center' : 'flex-end',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderBottomLeftRadius: tablet ? 24 : 0,
              borderBottomRightRadius: tablet ? 24 : 0,
              padding: 24,
              maxHeight: tablet ? '85%' : '80%',
              width: '100%',
              maxWidth: tablet ? 700 : undefined,
              alignSelf: 'center',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: colors.text,
                }}
              >
                Select Date
              </Text>
              <TouchableOpacity onPress={() => setShowDatePickerModal(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <DatePickerCalendar
              onDateSelect={(date) => {
                setEventDate(date);
                setShowDatePickerModal(false);
              }}
              selectedStartDate={eventDate}
              selectedEndDate={null}
              allowRangeSelection={false}
            />

            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                borderRadius: 8,
                padding: 12,
                marginTop: 16,
              }}
              onPress={() => setShowDatePickerModal(false)}
            >
              <Text style={{ color: 'white', textAlign: 'center', fontWeight: '500' }}>
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
