import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  TextInput,
  Modal,
  FlatList,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  getEmployeeLeaveBalance,
  calculateRemainingLeaves,
  createLeaveRequest,
  getEmployeeLeaveRequests,
} from '../utils/leaveManagement';
import {
  fetchTicketDepartments,
  getCategoryLabel,
} from '../utils/ticketDepartments';
import { departmentNamesMatch } from '../utils/orgNormalize';
import { getEmployeeByUsername } from '../utils/employees';
import DatePickerCalendar from '../components/DatePickerCalendar';
import { useTheme } from '../contexts/ThemeContext';
import { isTablet, responsivePadding, responsiveFont, spacing } from '../shared/utils/responsive';

export default function LeaveRequestScreen({ navigation, route }) {
  const { user } = route.params;
  const { colors } = useTheme();
  const tablet = isTablet();
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [leaveType, setLeaveType] = useState('annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employee, setEmployee] = useState(null);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDayPeriod, setHalfDayPeriod] = useState('morning');
  const [selectedPreviewDate, setSelectedPreviewDate] = useState(null); // Date selected in calendar but not yet assigned
  const [category, setCategory] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState(null);

  const loadDepartments = async () => {
    setDepartmentsLoading(true);
    setDepartmentsError(null);
    try {
      const result = await fetchTicketDepartments(user);
      if (!result.success) {
        setDepartments([]);
        setDepartmentsError(result.error || 'Failed to load departments');
        return;
      }
      const list = result.data || [];
      setDepartments(list);
      setCategory((prev) => {
        if (prev && list.some((d) => String(d.id) === String(prev))) {
          return prev;
        }
        if (employee?.departmentId) {
          const byId = list.find((d) => String(d.id) === String(employee.departmentId));
          if (byId) return String(byId.id);
        }
        if (employee?.department) {
          const byName = list.find((d) => departmentNamesMatch(d.name, employee.department));
          if (byName) return String(byName.id);
        }
        return list.length > 0 ? String(list[0].id) : null;
      });
    } catch (error) {
      console.error('Error loading departments:', error);
      setDepartments([]);
      setDepartmentsError('Failed to load departments');
    } finally {
      setDepartmentsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadDepartments();
    
    // Safely check if navigation and addListener exist
    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('focus', () => {
          loadData();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[LeaveRequestScreen] Failed to add navigation listener:', error);
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
            console.warn('[LeaveRequestScreen] Error unsubscribing navigation listener:', error);
          }
        }
      }
    };
  }, [navigation]);

  const loadData = async () => {
    await Promise.all([
      loadLeaveBalance(),
      loadMyRequests(),
      loadEmployee()
    ]);
  };

  const loadEmployee = async () => {
    try {
      const emp = await getEmployeeByUsername(user.username, user.companyId);
      setEmployee(emp);
    } catch (error) {
      console.error('Error loading employee:', error);
    }
  };

  const loadLeaveBalance = async () => {
    try {
      if (!employee) return;
      const balance = await getEmployeeLeaveBalance(employee.id);
      setLeaveBalance(balance);
    } catch (error) {
      console.error('Error loading leave balance:', error);
    }
  };

  const loadMyRequests = async () => {
    try {
      if (!employee) return;
      const requests = await getEmployeeLeaveRequests(employee.id);
      // Sort by requested date (newest first)
      const sorted = requests.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
      setMyRequests(sorted);
    } catch (error) {
      console.error('Error loading leave requests:', error);
    }
  };

  useEffect(() => {
    if (employee) {
      loadLeaveBalance();
      loadMyRequests();
    }
  }, [employee]);

  useEffect(() => {
    if (showRequestModal) {
      loadDepartments();
    }
  }, [showRequestModal]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const resetForm = () => {
    setStartDate('');
    setEndDate('');
    setReason('');
    setLeaveType('annual');
    setIsHalfDay(false);
    setHalfDayPeriod('morning');
    setSelectedPreviewDate(null);
    setCategory(departments.length > 0 ? String(departments[0].id) : null);
  };

  const handleSubmitRequest = async () => {
    if (!startDate) {
      Alert.alert('Error', 'Please select a date');
      return;
    }

    if (!isHalfDay && !endDate) {
      Alert.alert('Error', 'Please select both start and end dates');
      return;
    }

    if (!employee) {
      Alert.alert('Error', 'Employee data not loaded');
      return;
    }

    if (!category) {
      Alert.alert('Error', 'Please select a department');
      return;
    }

    if (departments.length === 0) {
      Alert.alert(
        'Error',
        departmentsError || 'No departments are available. Contact your administrator.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createLeaveRequest(
        employee.id,
        leaveType,
        startDate,
        isHalfDay ? startDate : endDate, // For half-day, end date = start date
        reason,
        isHalfDay,
        isHalfDay ? halfDayPeriod : null,
        category // Pass category for routing
      );

      if (result.success) {
        Alert.alert('Success', 'Leave request submitted successfully');
        setShowRequestModal(false);
        resetForm();
        await loadData();
      } else {
        Alert.alert('Error', result.error || 'Failed to submit leave request');
      }
    } catch (error) {
      console.error('Error submitting leave request:', error);
      Alert.alert('Error', 'Failed to submit leave request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return '#10b981'; // green
      case 'rejected':
        return '#ef4444'; // red
      case 'pending':
        return '#f59e0b'; // amber
      default:
        return '#6b7280'; // gray
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved':
        return 'checkmark-circle';
      case 'rejected':
        return 'close-circle';
      case 'pending':
        return 'time';
      default:
        return 'help-circle';
    }
  };

  const getLeaveTypeLabel = (type) => {
    switch (type) {
      case 'annual':
        return 'Annual Leave';
      case 'sick':
        return 'Sick Leave';
      case 'casual':
        return 'Casual Leave';
      default:
        return type;
    }
  };

  const renderRequest = ({ item }) => (
    <View className="rounded-xl p-4 mb-3 shadow-sm" style={{ backgroundColor: colors.surface }}>
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-1">
          <Text className="text-lg font-semibold" style={{ color: colors.text }}>
            {getLeaveTypeLabel(item.leaveType)}
          </Text>
          <Text className="text-sm" style={{ color: colors.textSecondary }}>
            {new Date(item.startDate).toLocaleDateString()}{item.startDate !== item.endDate ? ` - ${new Date(item.endDate).toLocaleDateString()}` : ''}
            {item.isHalfDay && ` (${item.halfDayPeriod === 'morning' ? 'Morning' : 'Afternoon'})`}
          </Text>
          <Text className="text-xs mt-1" style={{ color: colors.textTertiary }}>
            {item.isHalfDay ? 'Half day' : `${item.days} day${item.days !== 1 ? 's' : ''}`} • Requested {new Date(item.requestedAt).toLocaleDateString()}
          </Text>
        </View>
        <View className="items-end">
          <View className="flex-row items-center mb-1">
            <Ionicons 
              name={getStatusIcon(item.status)} 
              size={20} 
              color={getStatusColor(item.status)} 
            />
            <Text 
              className="text-sm font-medium ml-1 capitalize"
              style={{ color: getStatusColor(item.status) }}
            >
              {item.status}
            </Text>
          </View>
          {item.processedAt && (
            <Text className="text-xs" style={{ color: colors.textTertiary }}>
              {new Date(item.processedAt).toLocaleDateString()}
            </Text>
          )}
        </View>
      </View>
      {item.category && (
        <View className="flex-row items-center mt-2">
          <Ionicons name="business-outline" size={14} color={colors.textSecondary} />
          <Text className="text-sm ml-1" style={{ color: colors.textSecondary }}>
            Department: {getCategoryLabel(item.category, departments)}
          </Text>
        </View>
      )}
      {item.assignedTo && (
        <View className="flex-row items-center mt-1">
          <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
          <Text className="text-sm ml-1" style={{ color: colors.textSecondary }}>
            Assigned to: {item.assignedTo}
          </Text>
        </View>
      )}
      {item.reason && (
        <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
          Reason: {item.reason}
        </Text>
      )}
      {item.adminNotes && (
        <Text className="text-sm mt-2" style={{ color: item.status === 'rejected' ? colors.error : colors.success }}>
          Admin Note: {item.adminNotes}
        </Text>
      )}
    </View>
  );

  const remaining = leaveBalance ? calculateRemainingLeaves(leaveBalance) : null;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View className="px-6 py-4 shadow-sm" style={{ backgroundColor: colors.surface }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold" style={{ color: colors.text }}>
            Leave Requests
          </Text>
          <TouchableOpacity
            className="rounded-xl px-4 py-2"
            style={{ backgroundColor: colors.primary }}
            onPress={() => setShowRequestModal(true)}
          >
            <View className="flex-row items-center">
              <Ionicons name="add" size={18} color="white" />
              <Text className="text-white font-semibold ml-1">New Request</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        className="flex-1"
        style={{ backgroundColor: colors.background }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {/* Leave Balance Card */}
        {leaveBalance && remaining && (
          <View className="mx-4 my-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: colors.surface }}>
            <Text className="text-lg font-semibold mb-3" style={{ color: colors.text }}>
              Leave Balance
            </Text>
            <View className="space-y-2">
              <View className="flex-row justify-between items-center">
                <Text style={{ color: colors.textSecondary }}>Annual Leaves</Text>
                <Text className="font-semibold" style={{ color: colors.text }}>
                  {remaining.annual} / {leaveBalance.annualLeaves}
                </Text>
              </View>
              <View className="flex-row justify-between items-center">
                <Text style={{ color: colors.textSecondary }}>Sick Leaves</Text>
                <Text className="font-semibold" style={{ color: colors.text }}>
                  {remaining.sick} / {leaveBalance.sickLeaves}
                </Text>
              </View>
              <View className="flex-row justify-between items-center">
                <Text style={{ color: colors.textSecondary }}>Casual Leaves</Text>
                <Text className="font-semibold" style={{ color: colors.text }}>
                  {remaining.casual} / {leaveBalance.casualLeaves}
                </Text>
              </View>
              <View className="border-t pt-2 mt-2" style={{ borderColor: colors.border }}>
                <View className="flex-row justify-between items-center">
                  <Text className="font-semibold" style={{ color: colors.text }}>Total Remaining</Text>
                  <Text className="font-bold text-lg" style={{ color: colors.primary }}>
                    {remaining.total} days
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* My Requests */}
        <View className="px-4 pb-4">
          <Text className="text-lg font-semibold mb-3" style={{ color: colors.text }}>
            My Leave Requests
          </Text>
          {myRequests.length > 0 ? (
            <FlatList
              data={myRequests}
              renderItem={renderRequest}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          ) : (
            <View className="rounded-xl p-8 items-center" style={{ backgroundColor: colors.surface }}>
              <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
              <Text className="mt-4 text-center" style={{ color: colors.textSecondary }}>
                No leave requests yet
              </Text>
              <Text className="text-sm mt-2 text-center" style={{ color: colors.textTertiary }}>
                Tap "New Request" to submit a leave request
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* New Request Modal */}
      <Modal
        visible={showRequestModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowRequestModal(false);
          resetForm();
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View className="flex-1" style={{ justifyContent: tablet ? 'center' : 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <View className="rounded-t-3xl p-6" style={{ backgroundColor: colors.surface, maxHeight: tablet ? '85%' : '90%', width: '100%', maxWidth: tablet ? 700 : undefined, alignSelf: 'center', borderBottomLeftRadius: tablet ? 24 : 0, borderBottomRightRadius: tablet ? 24 : 0 }}>
              <ScrollView 
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold" style={{ color: colors.text }}>
                  New Leave Request
                </Text>
                <TouchableOpacity onPress={() => {
                  setShowRequestModal(false);
                  resetForm();
                }}>
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Leave Type Selection */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Leave Type</Text>
                <View className="flex-row space-x-2">
                  {['annual', 'sick', 'casual'].map((type) => {
                    const isSelected = leaveType === type;
                    return (
                      <TouchableOpacity
                        key={type}
                        className="flex-1 rounded-lg p-3 border-2"
                        style={{
                          borderColor: isSelected ? colors.primary : colors.border,
                          backgroundColor: isSelected ? colors.primaryLight : colors.surface,
                        }}
                        onPress={() => setLeaveType(type)}
                      >
                        <Text
                          className="text-center font-medium"
                          style={{
                            color: isSelected ? colors.primary : colors.text,
                          }}
                        >
                          {getLeaveTypeLabel(type)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Department (routing to department manager) */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Department *</Text>
                <Text className="text-xs mb-2" style={{ color: colors.textTertiary }}>
                  Select the department manager who should review this request
                </Text>
                {departmentsLoading ? (
                  <Text className="text-sm" style={{ color: colors.textSecondary }}>
                    Loading departments…
                  </Text>
                ) : departmentsError ? (
                  <View>
                    <Text className="text-sm mb-1" style={{ color: colors.error || '#ef4444' }}>
                      {departmentsError}
                    </Text>
                    <TouchableOpacity onPress={loadDepartments}>
                      <Text className="text-sm font-medium" style={{ color: colors.primary }}>
                        Tap to retry
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : departments.length === 0 ? (
                  <Text className="text-sm" style={{ color: colors.textSecondary }}>
                    No departments are configured for your company.
                  </Text>
                ) : (
                  <View className="flex-row flex-wrap gap-2">
                    {departments.map((dept) => {
                      const deptId = String(dept.id);
                      const isSelected = category === deptId;
                      return (
                        <TouchableOpacity
                          key={deptId}
                          className="rounded-lg p-3 border-2"
                          style={{
                            flexBasis: tablet ? '31%' : '48%',
                            maxWidth: tablet ? '31%' : '48%',
                            borderColor: isSelected ? colors.primary : colors.border,
                            backgroundColor: isSelected ? colors.primaryLight : colors.surface,
                          }}
                          onPress={() => setCategory(deptId)}
                        >
                          <Text
                            numberOfLines={2}
                            className="text-center font-medium text-sm"
                            style={{
                              color: isSelected ? colors.primary : colors.text,
                            }}
                          >
                            {dept.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {category && (
                  <Text className="text-xs mt-2" style={{ color: colors.textTertiary }}>
                    Will be routed to {getCategoryLabel(category, departments)} manager
                  </Text>
                )}
              </View>

              {/* Half Day Toggle */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Leave Duration</Text>
                <View className="flex-row space-x-2">
                  <TouchableOpacity
                    className="flex-1 rounded-lg p-3 border-2"
                    style={{
                      borderColor: !isHalfDay ? colors.primary : colors.border,
                      backgroundColor: !isHalfDay ? colors.primaryLight : colors.surface,
                    }}
                    onPress={() => setIsHalfDay(false)}
                  >
                    <Text
                      className="text-center font-medium"
                      style={{
                        color: !isHalfDay ? colors.primary : colors.text,
                      }}
                    >
                      Full Day(s)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 rounded-lg p-3 border-2"
                    style={{
                      borderColor: isHalfDay ? colors.primary : colors.border,
                      backgroundColor: isHalfDay ? colors.primaryLight : colors.surface,
                    }}
                    onPress={() => setIsHalfDay(true)}
                  >
                    <Text
                      className="text-center font-medium"
                      style={{
                        color: isHalfDay ? colors.primary : colors.text,
                      }}
                    >
                      Half Day
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Half Day Period Selection */}
              {isHalfDay && (
                <View className="mb-4">
                  <Text className="mb-2 font-medium" style={{ color: colors.text }}>Half Day Period</Text>
                  <View className="flex-row space-x-2">
                    <TouchableOpacity
                      className="flex-1 rounded-lg p-3 border-2"
                      style={{
                        borderColor: halfDayPeriod === 'morning' ? colors.warning : colors.border,
                        backgroundColor: halfDayPeriod === 'morning' ? colors.warningLight : colors.surface,
                      }}
                      onPress={() => setHalfDayPeriod('morning')}
                    >
                      <View className="items-center">
                        <Ionicons 
                          name="sunny-outline" 
                          size={20} 
                          color={halfDayPeriod === 'morning' ? colors.warning : colors.textSecondary} 
                        />
                        <Text
                          className="text-center font-medium mt-1"
                          style={{
                            color: halfDayPeriod === 'morning' ? colors.warning : colors.text,
                          }}
                        >
                          Morning
                        </Text>
                        <Text className="text-xs" style={{ color: colors.textTertiary }}>First half</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 rounded-lg p-3 border-2"
                      style={{
                        borderColor: halfDayPeriod === 'afternoon' ? colors.warning : colors.border,
                        backgroundColor: halfDayPeriod === 'afternoon' ? colors.warningLight : colors.surface,
                      }}
                      onPress={() => setHalfDayPeriod('afternoon')}
                    >
                      <View className="items-center">
                        <Ionicons 
                          name="partly-sunny-outline" 
                          size={20} 
                          color={halfDayPeriod === 'afternoon' ? colors.warning : colors.textSecondary} 
                        />
                        <Text
                          className="text-center font-medium mt-1"
                          style={{
                            color: halfDayPeriod === 'afternoon' ? colors.warning : colors.text,
                          }}
                        >
                          Afternoon
                        </Text>
                        <Text className="text-xs" style={{ color: colors.textTertiary }}>Second half</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Date Selection Calendar */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>
                  {isHalfDay ? 'Select Date' : 'Select Date Range'}
                </Text>
                {isHalfDay ? (
                  <DatePickerCalendar
                    onDateSelect={(date) => {
                      setSelectedPreviewDate(date);
                    }}
                    selectedStartDate={startDate}
                    selectedEndDate={null}
                    previewDate={selectedPreviewDate}
                    allowRangeSelection={false}
                  />
                ) : (
                  <DatePickerCalendar
                    onDateSelect={(date) => {
                      setSelectedPreviewDate(date);
                    }}
                    selectedStartDate={startDate}
                    selectedEndDate={endDate}
                    previewDate={selectedPreviewDate}
                    allowRangeSelection={true}
                  />
                )}

                {/* Action Buttons for Full Day Leaves */}
                {!isHalfDay && (
                  <View className="mt-4 flex-row space-x-2">
                    <TouchableOpacity
                      className="flex-1 rounded-lg p-3 border-2"
                      style={{
                        borderColor: startDate ? colors.error : selectedPreviewDate ? colors.primary : colors.border,
                        backgroundColor: startDate ? colors.errorLight : selectedPreviewDate ? colors.primary : colors.borderLight,
                      }}
                      onPress={() => {
                        if (startDate) {
                          // Unselect start date
                          setStartDate('');
                          if (endDate && endDate === startDate) {
                            setEndDate('');
                          }
                        } else if (selectedPreviewDate) {
                          // Set selected date as start date
                          setStartDate(selectedPreviewDate);
                          // If end date is before new start date, clear it
                          if (endDate && new Date(endDate) < new Date(selectedPreviewDate)) {
                            setEndDate('');
                          }
                          setSelectedPreviewDate(null); // Clear preview after assignment
                        }
                      }}
                      disabled={!selectedPreviewDate && !startDate}
                    >
                      <Text
                        className="text-center font-medium"
                        style={{
                          color: startDate
                            ? colors.error
                            : selectedPreviewDate
                            ? '#ffffff'
                            : colors.textTertiary,
                        }}
                      >
                        {startDate ? 'Unselect Start Date' : 'Select Start Date'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      className="flex-1 rounded-lg p-3 border-2"
                      style={{
                        borderColor: endDate ? colors.error : selectedPreviewDate && startDate && new Date(selectedPreviewDate) >= new Date(startDate) ? colors.primary : colors.border,
                        backgroundColor: endDate ? colors.errorLight : selectedPreviewDate && startDate && new Date(selectedPreviewDate) >= new Date(startDate) ? colors.primary : colors.borderLight,
                      }}
                      onPress={() => {
                        if (endDate) {
                          // Unselect end date
                          setEndDate('');
                        } else if (selectedPreviewDate && startDate) {
                          // Validate that end date is after start date
                          if (new Date(selectedPreviewDate) >= new Date(startDate)) {
                            setEndDate(selectedPreviewDate);
                            setSelectedPreviewDate(null); // Clear preview after assignment
                          } else {
                            Alert.alert('Invalid Date', 'End date must be on or after start date');
                          }
                        } else if (selectedPreviewDate && !startDate) {
                          Alert.alert('Select Start Date First', 'Please select a start date before selecting an end date');
                        }
                      }}
                      disabled={(!selectedPreviewDate || !startDate) && !endDate}
                    >
                      <Text
                        className="text-center font-medium"
                        style={{
                          color: endDate
                            ? colors.error
                            : selectedPreviewDate && startDate && new Date(selectedPreviewDate) >= new Date(startDate)
                            ? '#ffffff'
                            : colors.textTertiary,
                        }}
                      >
                        {endDate ? 'Unselect End Date' : 'Select End Date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Action Button for Half Day Leaves */}
                {isHalfDay && (
                  <View className="mt-4">
                    <TouchableOpacity
                      className="rounded-lg p-3 border-2"
                      style={{
                        borderColor: startDate ? colors.error : selectedPreviewDate ? colors.primary : colors.border,
                        backgroundColor: startDate ? colors.errorLight : selectedPreviewDate ? colors.primary : colors.borderLight,
                      }}
                      onPress={() => {
                        if (startDate) {
                          // Unselect date
                          setStartDate('');
                          setEndDate('');
                        } else if (selectedPreviewDate) {
                          // Set selected date
                          setStartDate(selectedPreviewDate);
                          setEndDate(selectedPreviewDate);
                          setSelectedPreviewDate(null); // Clear preview after assignment
                        }
                      }}
                      disabled={!selectedPreviewDate && !startDate}
                    >
                      <Text
                        className="text-center font-medium"
                        style={{
                          color: startDate
                            ? colors.error
                            : selectedPreviewDate
                            ? '#ffffff'
                            : colors.textTertiary,
                        }}
                      >
                        {startDate ? 'Unselect Date' : 'Select Date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Display Selected Dates */}
                {(startDate || endDate) && (
                  <View className="mt-3 flex-row items-center justify-center space-x-4">
                    {startDate && (
                      <View className="flex-row items-center">
                        <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                        <Text className="text-sm ml-1" style={{ color: colors.text }}>
                          {isHalfDay ? 'Date' : 'Start'}: {new Date(startDate).toLocaleDateString()}
                        </Text>
                      </View>
                    )}
                    {!isHalfDay && endDate && startDate !== endDate && (
                      <View className="flex-row items-center">
                        <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                        <Text className="text-sm ml-1" style={{ color: colors.text }}>
                          End: {new Date(endDate).toLocaleDateString()}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Reason */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Reason (Optional)</Text>
                <TextInput
                  className="rounded-xl px-4 py-3"
                  placeholder="Enter reason for leave..."
                  placeholderTextColor={colors.textTertiary}
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  style={{
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
              </View>

              <View className="flex-row space-x-2 mt-4">
                <TouchableOpacity
                  className="rounded-lg p-3 flex-1"
                  style={{ backgroundColor: colors.borderLight }}
                  onPress={() => {
                    setShowRequestModal(false);
                    resetForm();
                  }}
                >
                  <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  className="rounded-lg p-3 flex-1"
                  style={{
                    backgroundColor: colors.primary,
                    opacity:
                      isSubmitting ||
                      departmentsLoading ||
                      !category ||
                      departments.length === 0
                        ? 0.5
                        : 1,
                  }}
                  onPress={handleSubmitRequest}
                  disabled={
                    isSubmitting ||
                    departmentsLoading ||
                    !category ||
                    departments.length === 0
                  }
                >
                  <Text className="text-center font-medium text-white">
                    {isSubmitting ? 'Submitting...' : 'Submit Request'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

