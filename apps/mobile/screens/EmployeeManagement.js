import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { 
  getEmployees, 
  updateEmployeeWorkMode, 
  getWorkModeStatistics,
  getPendingWorkModeRequests,
  processWorkModeRequest,
  getManageableEmployees,
  canManageEmployee,
  updateEmployee
} from '../utils/employees';
import { isHRAdmin } from '../shared/constants/roles';
import { 
  getAllWorkModes, 
  getWorkModeLabel, 
  getWorkModeColor,
  getWorkModeIcon,
  WORK_MODES
} from '../utils/workModes';
import {
  getDefaultLeaveSettings,
  updateDefaultLeaveSettings,
  getEmployeeLeaveBalance,
  updateEmployeeLeaveBalance,
  resetEmployeeLeaveToDefault,
  calculateRemainingLeaves,
  getPendingLeaveRequests,
  processLeaveRequest,
  getAllLeaveRequests
} from '../utils/leaveManagement';
import { 
  getHRRoleFromPosition, 
  getHRRoleColor, 
  getHRRoleIcon, 
  getHRRoleLabel 
} from '../utils/hrRoles';
import { spacing, responsivePadding } from '../shared/utils/responsive';
import { useTheme } from '../contexts/ThemeContext';

export default function EmployeeManagement({ route, refreshTick = 0, onReloadComplete }) {
  const { user, openLeaveRequests } = route.params || {};
  const { colors } = useTheme();
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showWorkModeModal, setShowWorkModeModal] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [pendingLeaveRequests, setPendingLeaveRequests] = useState([]);
  const [showLeaveRequestsModal, setShowLeaveRequestsModal] = useState(openLeaveRequests || false);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState(null);
  const [employeeLeaveBalances, setEmployeeLeaveBalances] = useState({}); // { employeeId: { remaining, balance } }
  const [stats, setStats] = useState({ total: 0, inOffice: 0, semiRemote: 0, fullyRemote: 0 });
  
  // Leave Management States
  const [showLeaveSettingsModal, setShowLeaveSettingsModal] = useState(false);
  const [showEmployeeLeaveModal, setShowEmployeeLeaveModal] = useState(false);
  const [defaultLeaveSettings, setDefaultLeaveSettings] = useState({
    defaultAnnualLeaves: 20,
    defaultSickLeaves: 10,
    defaultCasualLeaves: 5
  });
  const [employeeLeaveData, setEmployeeLeaveData] = useState(null);
  const [leaveInputs, setLeaveInputs] = useState({
    annualLeaves: '',
    sickLeaves: '',
    casualLeaves: ''
  });
  const [showRoleEditModal, setShowRoleEditModal] = useState(false);
  const [selectedEmployeeForRoleEdit, setSelectedEmployeeForRoleEdit] = useState(null);
  const [selectedRole, setSelectedRole] = useState('employee');

  useEffect(() => {
    loadData();
  }, []);

  // Trigger full reload from parent (used by AdminDashboard pull-to-refresh).
  useEffect(() => {
    // If refreshTick is 0/undefined, skip; initial load is handled above.
    if (!refreshTick || refreshTick <= 0) return;

    (async () => {
      try {
        await loadData();
      } catch (error) {
        console.error('Error refreshing employees:', error);
      } finally {
        if (typeof onReloadComplete === 'function') {
          onReloadComplete();
        }
      }
    })();
  }, [refreshTick, onReloadComplete]);

  // Reload leave requests and statistics when employees change
  useEffect(() => {
    if (employees.length > 0) {
      loadPendingLeaveRequests();
      loadStatistics();
    }
  }, [employees]);

  const loadData = async () => {
    // Load employees first, then other data
    await loadEmployees();
    // Statistics will be loaded via useEffect when employees state updates
    await Promise.all([
      loadPendingRequests(),
      loadPendingLeaveRequests(),
      loadDefaultLeaveSettings()
    ]);
    // Load leave balances after employees are loaded
    if (employees.length > 0) {
      await loadEmployeeLeaveBalances();
    }
  };

  const loadEmployeeLeaveBalances = async () => {
    try {
      const balances = {};
      for (const employee of employees) {
        const balance = await getEmployeeLeaveBalance(employee.id);
        const remaining = calculateRemainingLeaves(balance);
        balances[employee.id] = { balance, remaining };
      }
      setEmployeeLeaveBalances(balances);
    } catch (error) {
      console.error('Error loading employee leave balances:', error);
    }
  };
  
  const loadDefaultLeaveSettings = async () => {
    try {
      const settings = await getDefaultLeaveSettings();
      setDefaultLeaveSettings(settings);
    } catch (error) {
      console.error('Error loading default leave settings:', error);
    }
  };

  const loadEmployees = async () => {
    try {
      // Get employees based on user's role
      // Super admins see everyone, managers see only their department
      const employeeList = await getManageableEmployees(user);
      setEmployees(employeeList);
      setFilteredEmployees(employeeList);
    } catch (error) {
      console.error('Error loading employees:', error);
      Alert.alert('Error', 'Failed to load employees');
    }
  };

  const loadPendingRequests = async () => {
    try {
      const requests = await getPendingWorkModeRequests();
      setPendingRequests(requests);
    } catch (error) {
      console.error('Error loading pending requests:', error);
    }
  };

  const loadPendingLeaveRequests = async () => {
    try {
      const allRequests = await getPendingLeaveRequests();
      
      // For super admins and HR admins, show all requests
      if (user.role === 'super_admin' || isHRAdmin(user)) {
        setPendingLeaveRequests(allRequests);
        return;
      }
      
      // For regular managers, show requests assigned to them OR from employees in their department
      const manageableEmployeeIds = new Set(employees.map(emp => emp.id));
      const filteredRequests = allRequests.filter(req => {
        // Show if assigned to this manager
        if (req.assignedTo === user.username) {
          return true;
        }
        // Show if from an employee in their department
        if (manageableEmployeeIds.has(req.employeeId)) {
          return true;
        }
        return false;
      });
      setPendingLeaveRequests(filteredRequests);
    } catch (error) {
      console.error('Error loading pending leave requests:', error);
    }
  };

  const loadStatistics = async () => {
    try {
      // Calculate statistics from the filtered employees (already filtered by department for managers)
      const stats = {
        total: employees.length,
        inOffice: 0,
        semiRemote: 0,
        fullyRemote: 0
      };
      
      employees.forEach(emp => {
        switch (emp.workMode) {
          case WORK_MODES.IN_OFFICE:
            stats.inOffice++;
            break;
          case WORK_MODES.SEMI_REMOTE:
            stats.semiRemote++;
            break;
          case WORK_MODES.FULLY_REMOTE:
            stats.fullyRemote++;
            break;
        }
      });
      
      setStats(stats);
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  };

  const handleWorkModeChange = (employee) => {
    // Check if user can manage this employee
    if (!canManageEmployee(user, employee)) {
      Alert.alert('Permission Denied', 'You can only manage work modes for employees in your department.');
      return;
    }
    setSelectedEmployee(employee);
    setShowWorkModeModal(true);
  };

  const confirmWorkModeChange = async (newWorkMode) => {
    try {
      const result = await updateEmployeeWorkMode(
        selectedEmployee.id || selectedEmployee.uid, 
        newWorkMode, 
        user  // Pass full user object for permission checks
      );
      
      if (result.success) {
        Alert.alert(
          'Success', 
          `${selectedEmployee.name}'s work mode updated to ${getWorkModeLabel(newWorkMode)}`
        );
        
        // Update local state immediately with returned data if available
        if (result.data) {
          setEmployees(prevEmployees => 
            prevEmployees.map(emp => 
              (emp.id === selectedEmployee.id || emp.uid === selectedEmployee.uid)
                ? { ...emp, workMode: result.data.workMode || result.data.work_mode, ...result.data }
                : emp
            )
          );
          setFilteredEmployees(prevFiltered => 
            prevFiltered.map(emp => 
              (emp.id === selectedEmployee.id || emp.uid === selectedEmployee.uid)
                ? { ...emp, workMode: result.data.workMode || result.data.work_mode, ...result.data }
                : emp
            )
          );
        }
        
        // Reload data from Supabase to get fresh state (ensures consistency)
        await loadData();
      } else {
        Alert.alert('Error', result.error || 'Failed to update work mode');
      }
    } catch (error) {
      console.error('Error updating work mode:', error);
      Alert.alert('Error', error.message || 'Failed to update work mode');
    } finally {
      setShowWorkModeModal(false);
      setSelectedEmployee(null);
    }
  };

  const handleProcessRequest = async (requestId, status) => {
    try {
      const success = await processWorkModeRequest(
        requestId, 
        status, 
        user.username,
        status === 'approved' ? 'Request approved' : 'Request rejected'
      );
      
      if (success) {
        Alert.alert(
          'Success', 
          `Request ${status} successfully`
        );
        await loadData();
      } else {
        Alert.alert('Error', 'Failed to process request');
      }
    } catch (error) {
      console.error('Error processing request:', error);
      Alert.alert('Error', 'Failed to process request');
    }
  };

  const handleProcessLeaveRequest = async (requestId, status) => {
    // Check if user can manage this leave request
    const request = pendingLeaveRequests.find(req => req.id === requestId);
    if (request) {
      // Super admins and HR admins can process any request
      if (user.role === 'super_admin' || isHRAdmin(user)) {
        // Allow processing
      } else if (request.assignedTo === user.username) {
        // Manager is assigned to this request - allow processing
      } else {
        // Check if employee is in manager's department
        const employee = employees.find(emp => emp.id === request.employeeId);
        if (employee && !canManageEmployee(user, employee)) {
          Alert.alert('Permission Denied', 'You can only manage leave requests assigned to you or from employees in your department.');
          return;
        }
      }
    }
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
        await loadData();
      } else {
        Alert.alert('Error', result.error || 'Failed to process leave request');
      }
    } catch (error) {
      console.error('Error processing leave request:', error);
      Alert.alert('Error', 'Failed to process leave request');
    }
  };

  const handleManageLeaves = async (employee) => {
    // Check if user can manage this employee
    if (!canManageEmployee(user, employee)) {
      Alert.alert('Permission Denied', 'You can only manage leaves for employees in your department.');
      return;
    }
    
    try {
      // Use employee.id for AsyncStorage employees
      const employeeId = employee.id;
      const leaveBalance = await getEmployeeLeaveBalance(employeeId);
      setEmployeeLeaveData({ ...employee, leaveBalance });
      setLeaveInputs({
        annualLeaves: leaveBalance.annualLeaves?.toString() || '',
        sickLeaves: leaveBalance.sickLeaves?.toString() || '',
        casualLeaves: leaveBalance.casualLeaves?.toString() || ''
      });
      setShowEmployeeLeaveModal(true);
    } catch (error) {
      console.error('Error loading employee leave balance:', error);
      Alert.alert('Error', 'Failed to load leave balance');
    }
  };

  const handleSaveEmployeeLeaves = async () => {
    try {
      const employeeId = employeeLeaveData.id;
      
      if (!leaveInputs.annualLeaves || !leaveInputs.sickLeaves || !leaveInputs.casualLeaves) {
        Alert.alert('Error', 'Please fill in all leave fields');
        return;
      }

      const annualLeaves = parseInt(leaveInputs.annualLeaves);
      const sickLeaves = parseInt(leaveInputs.sickLeaves);
      const casualLeaves = parseInt(leaveInputs.casualLeaves);

      if (isNaN(annualLeaves) || isNaN(sickLeaves) || isNaN(casualLeaves)) {
        Alert.alert('Error', 'Please enter valid numbers');
        return;
      }

      if (annualLeaves < 0 || sickLeaves < 0 || casualLeaves < 0) {
        Alert.alert('Error', 'Leave values cannot be negative');
        return;
      }

      const result = await updateEmployeeLeaveBalance(employeeId, {
        annualLeaves,
        sickLeaves,
        casualLeaves
      });

      if (result.success) {
        Alert.alert('Success', 'Leave balance updated successfully');
        setShowEmployeeLeaveModal(false);
        setEmployeeLeaveData(null);
        await loadData();
      } else {
        Alert.alert('Error', result.error || 'Failed to update leave balance');
      }
    } catch (error) {
      console.error('Error saving employee leaves:', error);
      Alert.alert('Error', 'Failed to save leave balance');
    }
  };

  const handleResetEmployeeLeaves = async () => {
    try {
      const employeeId = employeeLeaveData.id;
      
      Alert.alert(
        'Reset to Default',
        'Are you sure you want to reset this employee\'s leave balance to default values?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: async () => {
              const result = await resetEmployeeLeaveToDefault(employeeId);
              if (result.success) {
                Alert.alert('Success', 'Leave balance reset to default');
                setShowEmployeeLeaveModal(false);
                setEmployeeLeaveData(null);
                await loadData();
              } else {
                Alert.alert('Error', result.error || 'Failed to reset leave balance');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error resetting employee leaves:', error);
      Alert.alert('Error', 'Failed to reset leave balance');
    }
  };

  const handleSaveDefaultLeaves = async () => {
    try {
      Keyboard.dismiss();
      
      if (!defaultLeaveSettings.defaultAnnualLeaves || 
          !defaultLeaveSettings.defaultSickLeaves || 
          !defaultLeaveSettings.defaultCasualLeaves) {
        Alert.alert('Error', 'Please fill in all default leave fields');
        return;
      }

      const annualLeaves = parseInt(defaultLeaveSettings.defaultAnnualLeaves);
      const sickLeaves = parseInt(defaultLeaveSettings.defaultSickLeaves);
      const casualLeaves = parseInt(defaultLeaveSettings.defaultCasualLeaves);

      if (isNaN(annualLeaves) || isNaN(sickLeaves) || isNaN(casualLeaves)) {
        Alert.alert('Error', 'Please enter valid numbers');
        return;
      }

      if (annualLeaves < 0 || sickLeaves < 0 || casualLeaves < 0) {
        Alert.alert('Error', 'Leave values cannot be negative');
        return;
      }

      const result = await updateDefaultLeaveSettings({
        defaultAnnualLeaves: annualLeaves,
        defaultSickLeaves: sickLeaves,
        defaultCasualLeaves: casualLeaves
      });

      if (result.success) {
        Alert.alert('Success', 'Default leave settings updated successfully');
        setShowLeaveSettingsModal(false);
        await loadDefaultLeaveSettings();
      } else {
        Alert.alert('Error', result.error || 'Failed to update default leave settings');
      }
    } catch (error) {
      console.error('Error saving default leaves:', error);
      Alert.alert('Error', 'Failed to save default leave settings');
    }
  };

  const ROLES = [
    { value: 'employee', label: 'Employee' },
    { value: 'manager', label: 'Manager' },
    { value: 'super_admin', label: 'Super Admin' },
  ];

  const handleUpdateRole = async () => {
    if (!selectedEmployeeForRoleEdit) return;

    // HR admins cannot change roles to super_admin
    if (isHRAdmin(user) && selectedRole === 'super_admin') {
      Alert.alert('Permission Denied', 'HR admins cannot promote users to super admin. Only super admins can create or promote other super admins.');
      return;
    }

    // Prevent changing super_admin roles (only super_admins can do this)
    if (selectedEmployeeForRoleEdit.role === 'super_admin' && user.role !== 'super_admin') {
      Alert.alert('Permission Denied', 'Only super admins can modify super admin accounts.');
      return;
    }

    try {
      const result = await updateEmployee(selectedEmployeeForRoleEdit.id, {
        role: selectedRole,
      });

      if (result.success) {
        Alert.alert('Success', `Employee role updated to ${selectedRole}`);
        setShowRoleEditModal(false);
        setSelectedEmployeeForRoleEdit(null);
        await loadData();
      } else {
        Alert.alert('Error', result.error || 'Failed to update employee role');
      }
    } catch (error) {
      console.error('Error updating role:', error);
      Alert.alert('Error', 'Failed to update employee role');
    }
  };

  const renderEmployee = ({ item }) => {
    // Get employee ID
    const employeeId = item.id;
    const leaveInfo = employeeLeaveBalances[employeeId];
    
    return (
    <View className="rounded-xl p-4 mb-3 shadow-sm" style={{ backgroundColor: colors.surface }}>
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-lg font-semibold" style={{ color: colors.text }}>
            {item.name}
          </Text>
          <Text className="text-sm" style={{ color: colors.textSecondary }}>
            {item.department} • {item.position}
          </Text>
            {/* HR Role Display */}
            {item.position && (
              <View className="flex-row items-center mt-1">
                <Ionicons 
                  name={getHRRoleIcon(getHRRoleFromPosition(item.position))} 
                  size={12} 
                  color={getHRRoleColor(getHRRoleFromPosition(item.position))} 
                />
                <Text 
                  className="text-xs font-medium ml-1"
                  style={{ color: getHRRoleColor(getHRRoleFromPosition(item.position)) }}
                >
                  {getHRRoleLabel(getHRRoleFromPosition(item.position))}
                </Text>
              </View>
            )}
            <Text className="text-xs mt-1" style={{ color: colors.textTertiary }}>
            @{item.username}
          </Text>
            
            {/* Remaining Leaves Display */}
            {leaveInfo && leaveInfo.remaining && (
              <View className="mt-2 pt-2 border-t" style={{ borderColor: colors.borderLight }}>
                <Text className="text-xs mb-1" style={{ color: colors.textTertiary }}>Remaining Leaves:</Text>
                <View className="flex-row flex-wrap gap-x-3 gap-y-1">
                  <Text className="text-xs" style={{ color: colors.text }}>
                    <Text className="font-semibold" style={{ color: colors.primary }}>Annual:</Text> {leaveInfo.remaining.annual}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.text }}>
                    <Text className="font-semibold" style={{ color: colors.success }}>Sick:</Text> {leaveInfo.remaining.sick}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.text }}>
                    <Text className="font-semibold" style={{ color: colors.warning }}>Casual:</Text> {leaveInfo.remaining.casual}
                  </Text>
                  <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                    Total: {leaveInfo.remaining.total} days
                  </Text>
                </View>
              </View>
            )}
        </View>
        
        <View className="items-end" style={{ flexShrink: 1, minWidth: 0 }}>
          <View className="flex-row items-center mb-2">
            <Ionicons 
              name={getWorkModeIcon(item.workMode)} 
              size={16} 
              color={getWorkModeColor(item.workMode)} 
            />
            <Text 
              className="text-sm font-medium ml-1"
              style={{ color: getWorkModeColor(item.workMode) }}
            >
              {getWorkModeLabel(item.workMode)}
            </Text>
          </View>
          
          {/* Action Buttons - Responsive: wraps on small screens */}
          <View 
            style={{ 
              flexDirection: 'row', 
              flexWrap: 'wrap', 
              gap: spacing.xs,
              marginTop: spacing.xs / 2,
              justifyContent: 'flex-end', // Align buttons to the right when they wrap
              maxWidth: '100%', // Ensure container doesn't exceed parent width
            }}
          >
              <TouchableOpacity
                className="rounded-lg px-3 py-1"
                style={{ 
                  backgroundColor: colors.primary,
                  minWidth: 90, // Prevent buttons from being too narrow
                  flexShrink: 1,
                }}
                onPress={() => handleWorkModeChange(item)}
              >
                <Text className="text-white text-xs font-medium">Work Mode</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                className="rounded-lg px-3 py-1"
                style={{ 
                  backgroundColor: colors.success,
                  minWidth: 70, // Prevent buttons from being too narrow
                  flexShrink: 1,
                }}
                onPress={() => handleManageLeaves(item)}
              >
                <Text className="text-white text-xs font-medium">Leaves</Text>
              </TouchableOpacity>
              
              {/* Role Edit Button - For super_admin and HR admins */}
              {(user.role === 'super_admin' || isHRAdmin(user)) && (
                <TouchableOpacity
                  className="rounded-lg px-3 py-1"
                  style={{ 
                    backgroundColor: colors.primary,
                    minWidth: 60, // Prevent buttons from being too narrow
                    flexShrink: 1,
                  }}
                  onPress={() => {
                    // HR cannot edit super_admin accounts
                    if (isHRAdmin(user) && item.role === 'super_admin') {
                      Alert.alert('Permission Denied', 'HR admins cannot modify super admin accounts.');
                      return;
                    }
                    setSelectedEmployeeForRoleEdit(item);
                    setSelectedRole(item.role);
                    setShowRoleEditModal(true);
                  }}
                >
                  <Text className="text-white text-xs font-medium">Role</Text>
                </TouchableOpacity>
              )}
            </View>
        </View>
      </View>
    </View>
  );
  };

  const renderPendingRequest = ({ item }) => (
    <View className="rounded-xl p-4 mb-3 shadow-sm" style={{ backgroundColor: colors.surface }}>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-lg font-semibold" style={{ color: colors.text }}>
          {item.employeeId}
        </Text>
        <Text className="text-xs" style={{ color: colors.textTertiary }}>
          {new Date(item.requestedAt).toLocaleDateString()}
        </Text>
      </View>
      
      <Text className="mb-2" style={{ color: colors.textSecondary }}>
        Requesting: <Text className="font-medium">{getWorkModeLabel(item.requestedMode)}</Text>
      </Text>
      
      {item.reason && (
        <Text className="text-sm mb-3" style={{ color: colors.textTertiary }}>
          Reason: {item.reason}
        </Text>
      )}
      
      <View className="flex-row space-x-2">
        <TouchableOpacity
          className="rounded-lg px-4 py-2 flex-1"
          style={{ backgroundColor: colors.success }}
          onPress={() => handleProcessRequest(item.id, 'approved')}
        >
          <Text className="text-white text-center font-medium">Approve</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          className="rounded-lg px-4 py-2 flex-1"
          style={{ backgroundColor: colors.error }}
          onPress={() => handleProcessRequest(item.id, 'rejected')}
        >
          <Text className="text-white text-center font-medium">Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderPendingLeaveRequest = ({ item }) => {
    // Get employee name
    const employee = employees.find(emp => emp.id === item.employeeId);
    const employeeName = employee ? employee.name : item.employeeId;

    const getLeaveTypeLabel = (type) => {
      switch (type) {
        case 'annual': return 'Annual Leave';
        case 'sick': return 'Sick Leave';
        case 'casual': return 'Casual Leave';
        default: return type;
      }
    };

    return (
      <View className="rounded-xl p-4 mb-3 shadow-sm" style={{ backgroundColor: colors.surface }}>
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-lg font-semibold" style={{ color: colors.text }}>
            {employeeName}
          </Text>
          <Text className="text-xs" style={{ color: colors.textTertiary }}>
            {new Date(item.requestedAt).toLocaleDateString()}
          </Text>
        </View>
        
        <Text className="mb-2" style={{ color: colors.textSecondary }}>
          <Text className="font-medium">{getLeaveTypeLabel(item.leaveType)}</Text>
          {' • '}
          <Text className="font-medium">
            {item.isHalfDay ? 'Half day' : `${item.days} day${item.days !== 1 ? 's' : ''}`}
          </Text>
          {item.isHalfDay && (
            <Text style={{ color: colors.warning }}> ({item.halfDayPeriod === 'morning' ? 'Morning' : 'Afternoon'})</Text>
          )}
        </Text>
        
        <Text className="text-sm mb-1" style={{ color: colors.textTertiary }}>
          {new Date(item.startDate).toLocaleDateString()}
          {item.startDate !== item.endDate && ` - ${new Date(item.endDate).toLocaleDateString()}`}
        </Text>
        
        {item.reason && (
          <Text className="text-sm mb-3" style={{ color: colors.textTertiary }}>
            Reason: {item.reason}
          </Text>
        )}
        
        <View className="flex-row space-x-2">
          <TouchableOpacity
            className="rounded-lg px-4 py-2 flex-1"
            style={{ backgroundColor: colors.success }}
            onPress={() => handleProcessLeaveRequest(item.id, 'approved')}
          >
            <Text className="text-white text-center font-medium">Approve</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            className="rounded-lg px-4 py-2 flex-1"
            style={{ backgroundColor: colors.error }}
            onPress={() => handleProcessLeaveRequest(item.id, 'rejected')}
          >
            <Text className="text-white text-center font-medium">Reject</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const WorkModeModal = () => (
    <Modal
      visible={showWorkModeModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowWorkModeModal(false)}
    >
      <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
        <View className="rounded-xl p-6 mx-4 w-full max-w-sm" style={{ backgroundColor: colors.surface }}>
          <Text className="text-xl font-bold mb-4" style={{ color: colors.text }}>
            Change Work Mode
          </Text>
          
          <Text className="mb-4" style={{ color: colors.textSecondary }}>
            {selectedEmployee?.name} - Current: {getWorkModeLabel(selectedEmployee?.workMode)}
          </Text>
          
          {getAllWorkModes().map((mode) => {
            const isSelected = selectedEmployee?.workMode === mode.value;
            return (
              <TouchableOpacity
                key={mode.value}
                className="flex-row items-center p-3 rounded-lg mb-2"
                style={{
                  backgroundColor: isSelected ? colors.primaryLight : 'transparent',
                }}
                onPress={() => confirmWorkModeChange(mode.value)}
                disabled={isSelected}
              >
                <Ionicons 
                  name={mode.icon} 
                  size={20} 
                  color={mode.color} 
                />
                <View className="ml-3 flex-1">
                  <Text className="font-medium" style={{ color: colors.text }}>
                    {mode.label}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.textTertiary }}>
                    {mode.description}
                  </Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark" size={20} color={colors.success} />
                )}
              </TouchableOpacity>
            );
          })}
          
          <TouchableOpacity
            className="rounded-lg p-3 mt-4"
            style={{ backgroundColor: colors.borderLight }}
            onPress={() => setShowWorkModeModal(false)}
          >
            <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const PendingRequestsModal = () => (
    <Modal
      visible={showRequestsModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowRequestsModal(false)}
    >
      <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
        <View className="rounded-xl p-6 mx-4 w-full max-w-md max-h-96" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Pending Work Mode Requests
            </Text>
            <TouchableOpacity onPress={() => setShowRequestsModal(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          
          {pendingRequests.length > 0 ? (
            <FlatList
              data={pendingRequests}
              renderItem={renderPendingRequest}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View className="items-center py-8">
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text className="mt-2" style={{ color: colors.textSecondary }}>No pending work mode requests</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );

  const PendingLeaveRequestsModal = () => (
    <Modal
      visible={showLeaveRequestsModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowLeaveRequestsModal(false)}
    >
      <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
        <View className="rounded-xl p-6 mx-4 w-full max-w-md max-h-96" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Pending Leave Requests
            </Text>
            <TouchableOpacity onPress={() => setShowLeaveRequestsModal(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          
          {pendingLeaveRequests.length > 0 ? (
            <FlatList
              data={pendingLeaveRequests}
              renderItem={renderPendingLeaveRequest}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View className="items-center py-8">
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text className="mt-2" style={{ color: colors.textSecondary }}>No pending leave requests</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View className="px-6 py-4 shadow-sm" style={{ backgroundColor: colors.surface }}>
        <View className="flex-row items-center justify-between mb-4" style={{ flexWrap: 'wrap' }}>
          <Text className="text-xl font-bold" style={{ color: colors.text, flexShrink: 1, minWidth: 0 }}>
            Employee Management
          </Text>
          
          {/* Header Action Buttons - Responsive: wraps on small screens */}
          <View 
            style={{ 
              flexDirection: 'row', 
              flexWrap: 'wrap', 
              gap: spacing.xs,
              marginTop: spacing.xs,
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <TouchableOpacity
              className="rounded-xl px-4 py-2"
              style={{ 
                backgroundColor: colors.primary,
                minWidth: 100, // Prevent buttons from being too narrow
                flexShrink: 1,
              }}
              onPress={() => setShowLeaveSettingsModal(true)}
            >
              <View className="flex-row items-center">
                <Ionicons name="settings-outline" size={16} color="white" />
                <Text className="text-white font-semibold ml-1">Leaves</Text>
              </View>
            </TouchableOpacity>
          
            <TouchableOpacity
              className="rounded-xl px-4 py-2"
              style={{ 
                backgroundColor: colors.warning,
                minWidth: 120, // Prevent buttons from being too narrow (needs space for count)
                flexShrink: 1,
              }}
              onPress={() => setShowRequestsModal(true)}
            >
              <View className="flex-row items-center">
                <Ionicons name="notifications" size={16} color="white" />
                <Text className="text-white font-semibold ml-1">
                  Requests ({pendingRequests.length})
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Statistics */}
      <View className="mx-4 my-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: colors.surface }}>
        <Text className="text-lg font-semibold mb-3" style={{ color: colors.text }}>
          Work Mode Distribution
        </Text>
        <View className="flex-row justify-around">
          <View className="items-center">
            <Text className="text-2xl font-bold" style={{ color: colors.primary }}>{stats.inOffice}</Text>
            <Text className="text-sm" style={{ color: colors.textSecondary }}>In Office</Text>
          </View>
          <View className="items-center">
            <Text className="text-2xl font-bold" style={{ color: colors.warning }}>{stats.semiRemote}</Text>
            <Text className="text-sm" style={{ color: colors.textSecondary }}>Semi Remote</Text>
          </View>
          <View className="items-center">
            <Text className="text-2xl font-bold" style={{ color: colors.success }}>{stats.fullyRemote}</Text>
            <Text className="text-sm" style={{ color: colors.textSecondary }}>Fully Remote</Text>
          </View>
        </View>
      </View>

      {/* Employees List */}
      {filteredEmployees.length > 0 ? (
        <View style={{ padding: responsivePadding(16), paddingBottom: spacing['2xl'] }}>
          {filteredEmployees.map((item) => (
            <React.Fragment key={item.id}>
              {renderEmployee({ item })}
            </React.Fragment>
          ))}
        </View>
      ) : (
        <View className="justify-center items-center px-6" style={{ paddingVertical: spacing['2xl'] }}>
          <Ionicons name="people-outline" size={64} color={colors.textTertiary} />
          <Text className="text-xl font-semibold mt-4 text-center" style={{ color: colors.textSecondary }}>
            No employees found
          </Text>
          <Text className="text-center mt-2" style={{ color: colors.textTertiary }}>
            Employees will appear here once they are added to the system
          </Text>
        </View>
      )}

      <WorkModeModal />
      <PendingRequestsModal />
      <PendingLeaveRequestsModal />
      <LeaveSettingsModal
        visible={showLeaveSettingsModal}
        onClose={() => setShowLeaveSettingsModal(false)}
        defaultSettings={defaultLeaveSettings}
        onSave={handleSaveDefaultLeaves}
        onSettingsChange={setDefaultLeaveSettings}
      />
      {/* Role Edit Modal */}
      <Modal
        visible={showRoleEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoleEditModal(false)}
      >
        <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <View className="rounded-xl p-6 mx-4 w-full max-w-sm" style={{ backgroundColor: colors.surface }}>
            <Text className="text-xl font-bold mb-4" style={{ color: colors.text }}>
              Edit Employee Role
            </Text>
            
            {selectedEmployeeForRoleEdit && (
              <View className="mb-4">
                <Text className="mb-2" style={{ color: colors.textSecondary }}>
                  Employee: <Text className="font-medium">{selectedEmployeeForRoleEdit.name}</Text>
                </Text>
                <Text className="text-sm" style={{ color: colors.textTertiary }}>
                  @{selectedEmployeeForRoleEdit.username}
                </Text>
                <Text className="text-sm mt-1" style={{ color: colors.textTertiary }}>
                  Current Role: <Text className="font-medium capitalize">{selectedEmployeeForRoleEdit.role}</Text>
                </Text>
              </View>
            )}
            
            <Text className="font-medium mb-2" style={{ color: colors.text }}>
              Select New Role:
            </Text>
            <View className="mb-4">
              {ROLES.filter(role => {
                // HR admins cannot select super_admin role
                if (isHRAdmin(user) && role.value === 'super_admin') {
                  return false;
                }
                return true;
              }).map((role) => {
                const isSelected = selectedRole === role.value;
                return (
                  <TouchableOpacity
                    key={role.value}
                    className="rounded-lg p-3 mb-2"
                    style={{
                      backgroundColor: isSelected ? colors.primary : colors.borderLight,
                    }}
                    onPress={() => setSelectedRole(role.value)}
                  >
                    <Text 
                      className="font-medium"
                      style={{
                        color: isSelected ? '#ffffff' : colors.text,
                      }}
                    >
                      {role.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            
            <View className="flex-row space-x-3">
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{ backgroundColor: colors.borderLight }}
                onPress={() => {
                  setShowRoleEditModal(false);
                  setSelectedEmployeeForRoleEdit(null);
                }}
              >
                <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{ backgroundColor: colors.primary }}
                onPress={handleUpdateRole}
              >
                <Text className="text-center font-medium text-white">Update Role</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <EmployeeLeaveModal
        visible={showEmployeeLeaveModal}
        onClose={() => {
          setShowEmployeeLeaveModal(false);
          setEmployeeLeaveData(null);
        }}
        employeeData={employeeLeaveData}
        leaveInputs={leaveInputs}
        onInputChange={setLeaveInputs}
        onSave={handleSaveEmployeeLeaves}
        onReset={handleResetEmployeeLeaves}
      />
    </View>
  );
}

// Leave Settings Modal Component
const LeaveSettingsModal = ({ visible, onClose, defaultSettings, onSave, onSettingsChange }) => {
  const { colors } = useTheme();
  if (!visible) return null;
  
  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  const handleSaveAndClose = async () => {
    Keyboard.dismiss();
    await onSave();
  };

  const handleBack = async () => {
    Keyboard.dismiss();
    await onSave();
  };
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleBack}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View className="rounded-xl p-6 mx-4 w-full max-w-sm" style={{ backgroundColor: colors.surface }}>
              {/* Header with Back Button */}
              <View className="flex-row items-center justify-between mb-4">
                <TouchableOpacity
                  onPress={handleBack}
                  className="flex-row items-center"
                >
                  <Ionicons name="arrow-back" size={24} color="#3b82f6" />
                  <Text className="text-primary-500 font-semibold ml-2">Back</Text>
                </TouchableOpacity>
                <Text className="text-xl font-bold flex-1 text-center" style={{ color: colors.text }}>
                  Default Leave Settings
                </Text>
                <View style={{ width: 80 }} />
              </View>
              
              <Text className="mb-4 text-sm" style={{ color: colors.textSecondary }}>
                Set default leave balances for all employees. These values will be applied to new employees.
              </Text>
              
              {/* Annual Leaves */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Annual Leaves (days/year)</Text>
                <TextInput
                  className="rounded-xl px-4 py-3"
                  placeholder="20"
                  placeholderTextColor={colors.textTertiary}
                  value={defaultSettings?.defaultAnnualLeaves?.toString() || ''}
                  onChangeText={(text) => onSettingsChange({ ...defaultSettings, defaultAnnualLeaves: text })}
                  keyboardType="numeric"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => Keyboard.dismiss()}
                  style={{
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
              </View>
              
              {/* Sick Leaves */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Sick Leaves (days/year)</Text>
                <TextInput
                  className="rounded-xl px-4 py-3"
                  placeholder="10"
                  placeholderTextColor={colors.textTertiary}
                  value={defaultSettings?.defaultSickLeaves?.toString() || ''}
                  onChangeText={(text) => onSettingsChange({ ...defaultSettings, defaultSickLeaves: text })}
                  keyboardType="numeric"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => Keyboard.dismiss()}
                  style={{
                    backgroundColor: colors.background,
                    color: colors.text,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
              </View>
              
              {/* Casual Leaves */}
              <View className="mb-4">
                <Text className="mb-2 font-medium" style={{ color: colors.text }}>Casual Leaves (days/year)</Text>
                <TextInput
                  className="rounded-xl px-4 py-3"
                  placeholder="5"
                  placeholderTextColor={colors.textTertiary}
                  value={defaultSettings?.defaultCasualLeaves?.toString() || ''}
                  onChangeText={(text) => onSettingsChange({ ...defaultSettings, defaultCasualLeaves: text })}
                  keyboardType="numeric"
                  returnKeyType="done"
                  blurOnSubmit={true}
                  onSubmitEditing={() => Keyboard.dismiss()}
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
                  onPress={handleClose}
                >
                  <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  className="bg-primary-500 rounded-lg p-3 flex-1"
                  onPress={handleSaveAndClose}
                >
                  <Text className="text-center font-medium text-white">Save</Text>
                </TouchableOpacity>
              </View>
            </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// Employee Leave Modal Component
const EmployeeLeaveModal = ({ visible, onClose, employeeData, leaveInputs, onInputChange, onSave, onReset }) => {
  const { colors } = useTheme();
  if (!visible || !employeeData) return null;
  
  const remaining = employeeData.leaveBalance ? calculateRemainingLeaves(employeeData.leaveBalance) : null;

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  const handleSaveAndClose = async () => {
    Keyboard.dismiss();
    await onSave();
  };

  const handleBack = async () => {
    Keyboard.dismiss();
    await onSave();
  };
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleBack}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View className="rounded-xl p-6 mx-4 w-full max-w-sm max-h-96" style={{ backgroundColor: colors.surface }}>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Header with Back Button */}
                <View className="flex-row items-center justify-between mb-2">
                  <TouchableOpacity
                    onPress={handleBack}
                    className="flex-row items-center"
                  >
                    <Ionicons name="arrow-back" size={24} color={colors.primary} />
                    <Text className="font-semibold ml-2" style={{ color: colors.primary }}>Back</Text>
                  </TouchableOpacity>
                  <Text className="text-xl font-bold flex-1 text-center" style={{ color: colors.text }}>
                    Manage Leaves
                  </Text>
                  <View style={{ width: 80 }} />
                </View>
                
                <Text className="mb-4 text-sm" style={{ color: colors.textSecondary }}>
                  {employeeData.name} - {employeeData.position}
                </Text>
            
            {/* Current Leave Balance Display */}
            {employeeData.leaveBalance && (
              <View className="rounded-lg p-3 mb-4" style={{ backgroundColor: colors.background }}>
                <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>Current Balance:</Text>
                <View className="space-y-1">
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Annual: {employeeData.leaveBalance.usedAnnualLeaves || 0} / {employeeData.leaveBalance.annualLeaves || 0} used
                    {remaining && ` (${remaining.annual} remaining)`}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Sick: {employeeData.leaveBalance.usedSickLeaves || 0} / {employeeData.leaveBalance.sickLeaves || 0} used
                    {remaining && ` (${remaining.sick} remaining)`}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Casual: {employeeData.leaveBalance.usedCasualLeaves || 0} / {employeeData.leaveBalance.casualLeaves || 0} used
                    {remaining && ` (${remaining.casual} remaining)`}
                  </Text>
                </View>
                {employeeData.leaveBalance.isCustom && (
                  <Text className="text-xs mt-2" style={{ color: colors.primary }}>Custom leave balance</Text>
                )}
              </View>
            )}
            
            {/* Annual Leaves Input */}
            <View className="mb-4">
              <Text className="mb-2 font-medium" style={{ color: colors.text }}>Annual Leaves</Text>
              <TextInput
                className="rounded-xl px-4 py-3"
                placeholder="20"
                placeholderTextColor={colors.textTertiary}
                value={leaveInputs.annualLeaves}
                onChangeText={(text) => onInputChange({ ...leaveInputs, annualLeaves: text })}
                keyboardType="numeric"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => Keyboard.dismiss()}
                style={{
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />
            </View>
            
            {/* Sick Leaves Input */}
            <View className="mb-4">
              <Text className="mb-2 font-medium" style={{ color: colors.text }}>Sick Leaves</Text>
              <TextInput
                className="rounded-xl px-4 py-3"
                placeholder="10"
                placeholderTextColor={colors.textTertiary}
                value={leaveInputs.sickLeaves}
                onChangeText={(text) => onInputChange({ ...leaveInputs, sickLeaves: text })}
                keyboardType="numeric"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => Keyboard.dismiss()}
                style={{
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />
            </View>
            
            {/* Casual Leaves Input */}
            <View className="mb-4">
              <Text className="mb-2 font-medium" style={{ color: colors.text }}>Casual Leaves</Text>
              <TextInput
                className="rounded-xl px-4 py-3"
                placeholder="5"
                placeholderTextColor={colors.textTertiary}
                value={leaveInputs.casualLeaves}
                onChangeText={(text) => onInputChange({ ...leaveInputs, casualLeaves: text })}
                keyboardType="numeric"
                returnKeyType="done"
                blurOnSubmit={true}
                onSubmitEditing={() => Keyboard.dismiss()}
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
                onPress={handleClose}
              >
                <Text className="text-center font-medium" style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              
              {employeeData.leaveBalance?.isCustom && (
                <TouchableOpacity
                  className="rounded-lg p-3 flex-1"
                  style={{ backgroundColor: colors.warning }}
                  onPress={() => {
                    Keyboard.dismiss();
                    onReset();
                  }}
                >
                  <Text className="text-center font-medium text-white">Reset</Text>
                </TouchableOpacity>
              )}
              
              <TouchableOpacity
                className="rounded-lg p-3 flex-1"
                style={{ backgroundColor: colors.primary }}
                onPress={handleSaveAndClose}
              >
                <Text className="text-center font-medium text-white">Save</Text>
              </TouchableOpacity>
            </View>
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};
