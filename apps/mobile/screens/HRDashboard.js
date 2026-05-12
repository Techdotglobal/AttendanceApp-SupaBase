import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../core/contexts/AuthContext';
import { getAttendanceRecords } from '../utils/storage';
import { getAllLeaveRequests, getPendingLeaveRequests, processLeaveRequest } from '../utils/leaveManagement';
import {
  getAllTickets,
  getTicketsByStatus,
  TICKET_STATUS,
  getStatusLabel,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
  getCategoryLabel,
  CATEGORY_TO_DEPARTMENT_MAP,
  updateTicketStatus,
  getTicketById,
} from '../utils/ticketManagement';
import { getManageableEmployees, canManageEmployee } from '../utils/employees';
import { generateAttendanceReport, generateLeaveReport } from '../utils/export';
import { ROUTES } from '../shared/constants/routes';
import { spacing, fontSize, responsivePadding, responsiveFont, iconSize, isTablet } from '../shared/utils/responsive';
import { isHRAdmin } from '../shared/constants/roles';

export default function HRDashboard({ navigation, route }) {
  const { user: routeUser, initialTab, openLeaveRequests, ticketId } = route.params || {};
  const { user: authUser } = useAuth();
  const { colors } = useTheme();
  const tablet = isTablet();
  const tabletContentStyle = {
    width: '100%',
    maxWidth: tablet ? 1100 : undefined,
    alignSelf: 'center',
  };
  
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
  // Set initial tab from route params if provided (for notification navigation)
  const [activeTab, setActiveTab] = useState(initialTab || 'overview'); // overview, attendance, leaves, tickets
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Overview stats
  const [stats, setStats] = useState({
    totalEmployees: 0,
    totalAttendance: 0,
    pendingLeaves: 0,
    openTickets: 0,
  });
  
  // Attendance data
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  
  // Leave data
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  
  // Ticket data
  const [tickets, setTickets] = useState([]);
  const [ticketFilter, setTicketFilter] = useState('all');

  useEffect(() => {
    loadData();
    
    // Safely check if navigation and addListener exist
    let unsubscribe = null;
    if (navigation && typeof navigation.addListener === 'function') {
      try {
        unsubscribe = navigation.addListener('focus', () => {
          loadData();
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[HRDashboard] Failed to add navigation listener:', error);
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
            console.warn('[HRDashboard] Error unsubscribing navigation listener:', error);
          }
        }
      }
    };
  }, [navigation, activeTab, ticketFilter]);
  
  // Handle navigation params (e.g., from notifications)
  // IMPORTANT: This only changes the active tab - it does NOT trigger any actions
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
      if (__DEV__) {
        console.log('[HRDashboard] Navigation param: initialTab =', initialTab);
      }
    }
    if (openLeaveRequests) {
      setActiveTab('leaves');
      if (__DEV__) {
        console.log('[HRDashboard] Navigation param: openLeaveRequests = true, switching to leaves tab');
      }
    }
    if (ticketId) {
      setActiveTab('tickets');
      if (__DEV__) {
        console.log('[HRDashboard] Navigation param: ticketId =', ticketId, ', switching to tickets tab');
      }
      // Optionally, you could highlight the specific ticket here
    }
  }, [initialTab, openLeaveRequests, ticketId]);

  const loadData = async () => {
    await Promise.all([
      loadOverviewStats(),
      activeTab === 'attendance' && loadAttendanceData(),
      activeTab === 'leaves' && loadLeaveData(),
      activeTab === 'tickets' && loadTicketData(),
    ]);
  };

  const loadOverviewStats = async () => {
    try {
      // Get employees based on user role
      // HR admins and super admins see all employees
      const employees = await getManageableEmployees(user);
      
      const attendance = await getAttendanceRecords(user?.companyId);
      
      // Get pending leave requests (already filtered by role in getPendingLeaveRequests)
      const pending = await getPendingLeaveRequests();
      
      // Get tickets (filtered by role)
      let allTickets = await getAllTickets();
      // HR admins and super admins see all tickets
      if (user.role !== 'super_admin' && !isHRAdmin(user)) {
        // Filter tickets for regular managers (same logic as loadTicketData)
        const manageableEmployees = await getManageableEmployees(user);
        const manageableEmployeeUsernames = new Set(manageableEmployees.map(emp => emp.username));
        const managerDepartment = user.department;
        
        allTickets = allTickets.filter(ticket => {
          if (ticket.assignedTo === user.username) return true;
          if (manageableEmployeeUsernames.has(ticket.createdBy)) return true;
          const ticketDepartment = CATEGORY_TO_DEPARTMENT_MAP[ticket.category];
          if (ticketDepartment && ticketDepartment === managerDepartment) return true;
          return false;
        });
      }
      const openTickets = allTickets.filter(t => t.status === TICKET_STATUS.OPEN || t.status === TICKET_STATUS.IN_PROGRESS);

      setStats({
        totalEmployees: employees.length,
        totalAttendance: attendance.length,
        pendingLeaves: pending.length,
        openTickets: openTickets.length,
      });
    } catch (error) {
      console.error('Error loading overview stats:', error);
    }
  };

  const loadAttendanceData = async () => {
    try {
      const records = await getAttendanceRecords(user?.companyId);
      const sorted = records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setAttendanceRecords(sorted.slice(0, 50)); // Show last 50
    } catch (error) {
      console.error('Error loading attendance data:', error);
    }
  };

  const loadLeaveData = async () => {
    try {
      const allLeaves = await getAllLeaveRequests();
      const pending = await getPendingLeaveRequests();
      
      // getAllLeaveRequests now includes employeeName, so no need to enrich
      const sorted = allLeaves.sort((a, b) => new Date(b.requestedAt || b.createdAt) - new Date(a.requestedAt || a.createdAt));
      setLeaveRequests(sorted);
      setPendingLeaves(pending);
    } catch (error) {
      console.error('Error loading leave data:', error);
    }
  };

  const loadTicketData = async () => {
    try {
      let allTicketsData = await getAllTickets();
      
      // For super admins and HR admins, show all tickets
      if (user.role !== 'super_admin' && !isHRAdmin(user)) {
        // For other managers, show tickets assigned to them OR tickets from their department category
        const manageableEmployees = await getManageableEmployees(user);
        const manageableEmployeeUsernames = new Set(manageableEmployees.map(emp => emp.username));
        
        // Get manager's department
        const managerDepartment = user.department;
        
        allTicketsData = allTicketsData.filter(ticket => {
          // Show if assigned to this manager
          if (ticket.assignedTo === user.username) {
            return true;
          }
          // Show if created by an employee in their department
          if (manageableEmployeeUsernames.has(ticket.createdBy)) {
            return true;
          }
          // Show if ticket category matches manager's department
          const ticketDepartment = CATEGORY_TO_DEPARTMENT_MAP[ticket.category];
          if (ticketDepartment && ticketDepartment === managerDepartment) {
            return true;
          }
          return false;
        });
      }
      
      // Apply status filter
      if (ticketFilter !== 'all') {
        allTicketsData = allTicketsData.filter(t => t.status === ticketFilter);
      }
      
      const sorted = allTicketsData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setTickets(sorted);
    } catch (error) {
      console.error('Error loading ticket data:', error);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleGenerateAttendanceReport = async () => {
    try {
      Alert.alert('Generating Report', 'Please wait while we generate the attendance report...');
      const result = await generateAttendanceReport(user?.companyId);
      
      if (result.success) {
        Alert.alert(
          'Report Generated',
          `Attendance report has been saved:\n${result.fileName}\n\nLocation: ${result.fileUri}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to generate attendance report');
      }
    } catch (error) {
      console.error('Error generating attendance report:', error);
      Alert.alert('Error', 'Failed to generate attendance report');
    }
  };

  const handleGenerateLeaveReport = async () => {
    try {
      Alert.alert('Generating Report', 'Please wait while we generate the leave report...');
      const result = await generateLeaveReport(user?.companyId);
      
      if (result.success) {
        Alert.alert(
          'Report Generated',
          `Leave report has been saved:\n${result.fileName}\n\nLocation: ${result.fileUri}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to generate leave report');
      }
    } catch (error) {
      console.error('Error generating leave report:', error);
      Alert.alert('Error', 'Failed to generate leave report');
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getLeaveStatusColor = (status) => {
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

  const handleProcessLeaveRequest = async (requestId, status) => {
    // Defensive check: Ensure status is valid
    if (status !== 'approved' && status !== 'rejected') {
      if (__DEV__) {
        console.error('[HRDashboard] Invalid leave request status:', status);
      }
      Alert.alert('Error', 'Invalid action. Please try again.');
      return;
    }
    
    // Find the request
    const request = leaveRequests.find(req => req.id === requestId);
    if (!request) {
      Alert.alert('Error', 'Leave request not found');
      return;
    }

    // Check permissions
    // HR admins and super admins can manage all leave requests
    if (user.role !== 'super_admin' && !isHRAdmin(user)) {
      // For regular managers, check if they can manage this request
      let canManage = false;
      
      // Check if request is assigned to this manager
      if (request.assignedTo === user.username) {
        canManage = true;
      } else {
        // Check if employee is in manager's department
        const employees = await getManageableEmployees(user);
        const employee = employees.find(emp => emp.id === request.employeeId);
        if (employee && canManageEmployee(user, employee)) {
          canManage = true;
        }
      }
      
      if (!canManage) {
        Alert.alert('Permission Denied', 'You can only manage leave requests assigned to you or from employees in your department.');
        return;
      }
    }

    // Confirm action
    const actionText = status === 'approved' ? 'approve' : 'reject';
    Alert.alert(
      `${status === 'approved' ? 'Approve' : 'Reject'} Leave Request`,
      `Are you sure you want to ${actionText} this leave request?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: status === 'approved' ? 'Approve' : 'Reject',
          style: status === 'approved' ? 'default' : 'destructive',
          onPress: async () => {
            try {
              const result = await processLeaveRequest(
                requestId,
                status,
                user.username,
                status === 'approved' ? 'Leave request approved' : 'Leave request rejected'
              );

              if (result.success) {
                Alert.alert(
                  'Success',
                  `Leave request ${status} successfully`
                );
                await loadLeaveData();
                await loadOverviewStats(); // Refresh stats
              } else {
                Alert.alert('Error', result.error || 'Failed to process leave request');
              }
            } catch (error) {
              console.error('Error processing leave request:', error);
              Alert.alert('Error', 'Failed to process leave request');
            }
          },
        },
      ]
    );
  };

  const handleCloseTicket = async (ticketId) => {
    // Find the ticket
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) {
      Alert.alert('Error', 'Ticket not found');
      return;
    }

    // Check permissions
    // HR admins and super admins can manage all tickets
    if (user.role !== 'super_admin' && !isHRAdmin(user)) {
      // For regular managers, check if they can manage this ticket
      let canManage = false;
      
      // Check if ticket is assigned to this manager
      if (ticket.assignedTo === user.username) {
        canManage = true;
      } else {
        // Check if ticket category matches manager's department
        const ticketDepartment = CATEGORY_TO_DEPARTMENT_MAP[ticket.category];
        if (ticketDepartment && ticketDepartment === user.department) {
          canManage = true;
        }
      }
      
      if (!canManage) {
        Alert.alert('Permission Denied', 'You can only close tickets assigned to you or from your department.');
        return;
      }
    }

    // Confirm action
    Alert.alert(
      'Close Ticket',
      'Are you sure you want to close this ticket?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await updateTicketStatus(
                ticketId,
                TICKET_STATUS.CLOSED,
                user.username
              );

              if (result.success) {
                Alert.alert(
                  'Success',
                  'Ticket closed successfully'
                );
                await loadTicketData();
                await loadOverviewStats(); // Refresh stats
              } else {
                Alert.alert('Error', result.error || 'Failed to close ticket');
              }
            } catch (error) {
              console.error('Error closing ticket:', error);
              Alert.alert('Error', 'Failed to close ticket');
            }
          },
        },
      ]
    );
  };

  const renderOverview = () => (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: spacing['2xl'] }}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
    >
      <View style={{ padding: responsivePadding(16) }}>
        {/* Stats Cards - Responsive: wraps on small screens */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.base }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: responsivePadding(20),
              width: '47%',
              minWidth: 140, // Prevent too narrow on small screens
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
              <View
                style={{
                  width: iconSize.lg,
                  height: iconSize.lg,
                  borderRadius: iconSize.lg / 2,
                  backgroundColor: colors.primaryLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="people" size={iconSize.md} color={colors.primary} />
              </View>
              <View>
                <Text style={{ fontSize: fontSize['2xl'], fontWeight: 'bold', color: colors.text }}>
                  {stats.totalEmployees}
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>Employees</Text>
              </View>
            </View>
          </View>

          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: responsivePadding(20),
              width: '47%',
              minWidth: 140,
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
              <View
                style={{
                  width: iconSize.lg,
                  height: iconSize.lg,
                  borderRadius: iconSize.lg / 2,
                  backgroundColor: '#10b98120',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="time" size={iconSize.md} color="#10b981" />
              </View>
              <View>
                <Text style={{ fontSize: fontSize['2xl'], fontWeight: 'bold', color: colors.text }}>
                  {stats.totalAttendance}
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>Attendance</Text>
              </View>
            </View>
          </View>

          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: responsivePadding(20),
              width: '47%',
              minWidth: 140,
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
              <View
                style={{
                  width: iconSize.lg,
                  height: iconSize.lg,
                  borderRadius: iconSize.lg / 2,
                  backgroundColor: '#f59e0b20',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="calendar" size={iconSize.md} color="#f59e0b" />
              </View>
              <View>
                <Text style={{ fontSize: fontSize['2xl'], fontWeight: 'bold', color: colors.text }}>
                  {stats.pendingLeaves}
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>Pending Leaves</Text>
              </View>
            </View>
          </View>

          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: responsivePadding(20),
              width: '47%',
              minWidth: 140,
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
              <View
                style={{
                  width: iconSize.lg,
                  height: iconSize.lg,
                  borderRadius: iconSize.lg / 2,
                  backgroundColor: '#ef444420',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="ticket" size={iconSize.md} color="#ef4444" />
              </View>
              <View>
                <Text style={{ fontSize: fontSize['2xl'], fontWeight: 'bold', color: colors.text }}>
                  {stats.openTickets}
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>Open Tickets</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={{ marginBottom: spacing.base }}>
          <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginBottom: spacing.md }}>
            Quick Actions
          </Text>
          <View style={{ gap: spacing.md }}>
            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(16),
                flexDirection: 'row',
                alignItems: 'center',
                shadowColor: colors.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 3,
              }}
              onPress={() => navigation.navigate(ROUTES.EMPLOYEE_MANAGEMENT, { user, openLeaveRequests: false })}
            >
              <View
                style={{
                  width: iconSize['2xl'],
                  height: iconSize['2xl'],
                  borderRadius: iconSize['2xl'] / 2,
                  backgroundColor: colors.primaryLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="people-outline" size={iconSize.lg} color={colors.primary} />
              </View>
              <View style={{ flex: 1, flexShrink: 1 }}>
                <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}>
                  Manage Employees
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                  View and manage employee profiles
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(16),
                flexDirection: 'row',
                alignItems: 'center',
                shadowColor: colors.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 3,
              }}
              onPress={handleGenerateAttendanceReport}
            >
              <View
                style={{
                  width: iconSize['2xl'],
                  height: iconSize['2xl'],
                  borderRadius: iconSize['2xl'] / 2,
                  backgroundColor: '#10b98120',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="document-text-outline" size={iconSize.lg} color="#10b981" />
              </View>
              <View style={{ flex: 1, flexShrink: 1 }}>
                <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}>
                  Generate Attendance Report
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                  Export attendance data
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(16),
                flexDirection: 'row',
                alignItems: 'center',
                shadowColor: colors.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 3,
              }}
              onPress={handleGenerateLeaveReport}
            >
              <View
                style={{
                  width: iconSize['2xl'],
                  height: iconSize['2xl'],
                  borderRadius: iconSize['2xl'] / 2,
                  backgroundColor: '#f59e0b20',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.md,
                }}
              >
                <Ionicons name="document-text-outline" size={iconSize.lg} color="#f59e0b" />
              </View>
              <View style={{ flex: 1, flexShrink: 1 }}>
                <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}>
                  Generate Leave Report
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                  Export leave data
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScrollView>
  );

  const renderAttendance = () => (
    <View style={{ flex: 1 }}>
      <View style={{ padding: responsivePadding(16) }}>
        <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginBottom: spacing.md }}>
          Recent Attendance Records
        </Text>
      </View>
      {attendanceRecords.length > 0 ? (
        <FlatList
          data={attendanceRecords}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: spacing['2xl'] }}
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(16),
                marginHorizontal: responsivePadding(16),
                marginBottom: spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1, flexShrink: 1 }}>
                  <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}>
                    {item.username}
                  </Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                    {formatDate(item.timestamp)}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: item.type === 'checkin' ? '#10b98120' : '#ef444420',
                    borderRadius: 12,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    marginLeft: spacing.xs,
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      fontWeight: '600',
                      color: item.type === 'checkin' ? '#10b981' : '#ef4444',
                      textTransform: 'capitalize',
                    }}
                  >
                    {item.type}
                  </Text>
                </View>
              </View>
            </View>
          )}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] }}>
          <Ionicons name="time-outline" size={iconSize['4xl']} color={colors.textTertiary} />
          <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginTop: spacing.base }}>
            No attendance records
          </Text>
        </View>
      )}
    </View>
  );

  const renderLeaves = () => (
    <View style={{ flex: 1 }}>
      <View style={{ padding: responsivePadding(16) }}>
        <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginBottom: spacing.md }}>
          Leave Requests
        </Text>
        {pendingLeaves.length > 0 && (
          <View
            style={{
              backgroundColor: '#f59e0b20',
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ fontSize: fontSize.base, fontWeight: '600', color: '#f59e0b' }}>
              {pendingLeaves.length} Pending Leave Request{pendingLeaves.length !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </View>
      {leaveRequests.length > 0 ? (
        <FlatList
          data={leaveRequests}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(16),
                marginHorizontal: responsivePadding(16),
                marginBottom: spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs }}>
                <View style={{ flex: 1, flexShrink: 1 }}>
                  <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}>
                    {item.employeeName || item.employeeId}
                  </Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                    {item.startDate}{item.startDate !== item.endDate ? ` to ${item.endDate}` : ''} ({item.isHalfDay ? 'Half day' : `${item.days} day${item.days !== 1 ? 's' : ''}`})
                    {item.isHalfDay && ` - ${item.halfDayPeriod === 'morning' ? 'Morning' : 'Afternoon'}`}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: getLeaveStatusColor(item.status) + '20',
                    borderRadius: 12,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    marginLeft: spacing.xs,
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      fontWeight: '600',
                      color: getLeaveStatusColor(item.status),
                      textTransform: 'capitalize',
                    }}
                  >
                    {item.status}
                  </Text>
                </View>
              </View>
              <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary, textTransform: 'capitalize', marginBottom: spacing.xs }}>
                {item.leaveType} Leave
              </Text>
              {item.reason && (
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.xs, fontStyle: 'italic' }}>
                  Reason: {item.reason}
                </Text>
              )}
              {item.status === 'pending' && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                  <TouchableOpacity
                    onPress={() => handleProcessLeaveRequest(item.id, 'approved')}
                    style={{
                      flex: 1,
                      minWidth: 120, // Prevent buttons from being too narrow
                      backgroundColor: '#10b981',
                      borderRadius: 8,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.base,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={iconSize.md} color="#fff" style={{ marginRight: spacing.xs }} />
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: fontSize.base }}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleProcessLeaveRequest(item.id, 'rejected')}
                    style={{
                      flex: 1,
                      minWidth: 120,
                      backgroundColor: '#ef4444',
                      borderRadius: 8,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.base,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="close-circle" size={iconSize.md} color="#fff" style={{ marginRight: spacing.xs }} />
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: fontSize.base }}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
              {item.status !== 'pending' && item.processedBy && (
                <Text style={{ fontSize: fontSize.xs, color: colors.textTertiary, marginTop: spacing.xs }}>
                  {item.status === 'approved' ? 'Approved' : 'Rejected'} by {item.processedBy}
                  {item.processedAt && ` on ${formatDate(item.processedAt)}`}
                </Text>
              )}
            </View>
          )}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] }}>
          <Ionicons name="calendar-outline" size={iconSize['4xl']} color={colors.textTertiary} />
          <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginTop: spacing.base }}>
            No leave requests
          </Text>
        </View>
      )}
    </View>
  );

  const renderTickets = () => (
    <View style={{ flex: 1 }}>
      <View style={{ padding: responsivePadding(16) }}>
        <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginBottom: spacing.md }}>
          Tickets
        </Text>
        {/* Filter Tabs - Responsive: wraps on small screens */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
          {['all', TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED].map((filterType) => (
            <TouchableOpacity
              key={filterType}
              onPress={() => setTicketFilter(filterType)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 16,
                backgroundColor: ticketFilter === filterType ? colors.primary : colors.background,
              }}
            >
              <Text
                style={{
                  color: ticketFilter === filterType ? 'white' : colors.textSecondary,
                  fontWeight: ticketFilter === filterType ? '600' : '400',
                  fontSize: fontSize.sm,
                  textTransform: 'capitalize',
                }}
              >
                {filterType === 'all' ? 'All' : getStatusLabel(filterType)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {tickets.length > 0 ? (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: responsivePadding(16),
                marginHorizontal: responsivePadding(16),
                marginBottom: spacing.md,
              }}
              onPress={() => navigation.navigate('TicketManagement', { user, ticket: item })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs }}>
                <View style={{ flex: 1, flexShrink: 1 }}>
                  <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.text }}>
                    {item.subject}
                  </Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                    By {item.createdBy} • {formatDate(item.createdAt)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginLeft: spacing.xs }}>
                  <View
                    style={{
                      backgroundColor: getStatusColor(item.status) + '20',
                      borderRadius: 12,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      marginBottom: spacing.xs / 2,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: fontSize.sm,
                        fontWeight: '600',
                        color: getStatusColor(item.status),
                      }}
                    >
                      {getStatusLabel(item.status)}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: getPriorityColor(item.priority) + '20',
                      borderRadius: 12,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: fontSize.sm,
                        fontWeight: '600',
                        color: getPriorityColor(item.priority),
                      }}
                    >
                      {getPriorityLabel(item.priority)}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.xs }}>
                <Ionicons name="pricetag-outline" size={iconSize.sm} color={colors.textSecondary} />
                <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginLeft: spacing.xs }}>
                  {getCategoryLabel(item.category)}
                </Text>
                {item.assignedTo && (
                  <>
                    <Text style={{ color: colors.textTertiary, marginHorizontal: spacing.xs }}>•</Text>
                    <Ionicons name="person-outline" size={iconSize.sm} color={colors.textSecondary} />
                    <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginLeft: spacing.xs }}>
                      {item.assignedTo}
                    </Text>
                  </>
                )}
              </View>
              {/* Action Buttons - Responsive: wraps on small screens */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('TicketManagement', { user, ticket: item })}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    backgroundColor: colors.primary,
                    borderRadius: 8,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.base,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="eye-outline" size={iconSize.sm} color="#fff" style={{ marginRight: spacing.xs }} />
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: fontSize.sm }}>View Details</Text>
                </TouchableOpacity>
                {item.status !== TICKET_STATUS.CLOSED && (
                  <TouchableOpacity
                    onPress={() => handleCloseTicket(item.id)}
                    style={{
                      flex: 1,
                      minWidth: 120,
                      backgroundColor: '#6b7280',
                      borderRadius: 8,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.base,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="close-circle-outline" size={iconSize.sm} color="#fff" style={{ marginRight: spacing.xs }} />
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: fontSize.sm }}>Close</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] }}>
          <Ionicons name="ticket-outline" size={iconSize['4xl']} color={colors.textTertiary} />
          <Text style={{ fontSize: responsiveFont(18), fontWeight: '600', color: colors.text, marginTop: spacing.base }}>
            No tickets
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          ...tabletContentStyle,
          backgroundColor: colors.surface,
          paddingHorizontal: tablet ? responsivePadding(24) : responsivePadding(16),
          paddingVertical: spacing.md,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }}
      >
        <Text
          style={{
            fontSize: responsiveFont(20),
            fontWeight: 'bold',
            color: colors.text,
            marginBottom: spacing.md,
          }}
        >
          HR Dashboard
        </Text>

        {/* Tab Navigation - Responsive: wraps on small screens */}
        <View style={{ flexDirection: 'row', flexWrap: tablet ? 'nowrap' : 'wrap', gap: spacing.xs }}>
          {['overview', 'attendance', 'leaves', 'tickets'].map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={{
                paddingHorizontal: tablet ? responsivePadding(20) : responsivePadding(16),
                paddingVertical: spacing.xs,
                borderRadius: 20,
                backgroundColor: activeTab === tab ? colors.primary : colors.background,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: activeTab === tab ? 'white' : colors.textSecondary,
                  fontWeight: activeTab === tab ? '600' : '400',
                  fontSize: fontSize.base,
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Content */}
      <View style={[{ flex: 1 }, tabletContentStyle]}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'attendance' && renderAttendance()}
        {activeTab === 'leaves' && renderLeaves()}
        {activeTab === 'tickets' && renderTickets()}
      </View>
    </View>
  );
}

