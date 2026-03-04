// Main Application Navigation - Routes based on user role
import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ROLES, isHRAdmin } from '../../shared/constants/roles';
import { ROUTES } from '../../shared/constants/routes';
import { useTheme } from '../contexts/ThemeContext';

// Import screens
import EmployeeDashboard from '../../screens/EmployeeDashboard';
import AdminDashboard from '../../screens/AdminDashboard';
import AttendanceHistory from '../../screens/AttendanceHistory';
import AuthenticationScreen from '../../screens/AuthenticationScreen';
import AuthMethodSelection from '../../screens/AuthMethodSelection';
import LeaveRequestScreen from '../../screens/LeaveRequestScreen';
import CalendarScreen from '../../screens/CalendarScreen';
import ThemeSettingsScreen from '../../screens/ThemeSettingsScreen';
import NotificationsScreen from '../../screens/NotificationsScreen';
import TicketScreen from '../../screens/TicketScreen';
import HRDashboard from '../../screens/HRDashboard';
import TicketManagementScreen from '../../screens/TicketManagementScreen';
import ManualAttendanceScreen from '../../screens/ManualAttendanceScreen';
import SignupApprovalScreen from '../../screens/SignupApprovalScreen';
import CreateUserScreen from '../../screens/CreateUserScreen';
import EmployeeManagement from '../../screens/EmployeeManagement';
import ReportsScreen from '../../screens/ReportsScreen';
import LoginScreen from '../../screens/LoginScreen';
import AttendanceSettingsScreen from '../../screens/AttendanceSettingsScreen';
import HelpSupportScreen from '../../screens/HelpSupportScreen';
import { GeoFencingScreen } from '../../features/geofencing';
import { CompanySettingsScreen } from '../../features/company';

const Stack = createStackNavigator();

export default function MainNavigator({ user }) {
  const { colors } = useTheme();

  // Hamburger menu icon component
  const HamburgerMenu = ({ navigation }) => (
    <TouchableOpacity
      onPress={() => navigation.openDrawer()}
      style={{ marginLeft: 16 }}
      activeOpacity={0.7}
    >
      <Ionicons name="menu" size={28} color="#fff" />
    </TouchableOpacity>
  );

  const screenOptions = ({ navigation }) => ({
    headerStyle: {
      backgroundColor: colors.primary,
    },
    headerTintColor: '#fff',
    headerTitleStyle: {
      fontWeight: 'bold',
    },
    headerLeft: () => <HamburgerMenu navigation={navigation} />,
  });

  if (user.role === ROLES.EMPLOYEE) {
    return (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen 
          name={ROUTES.EMPLOYEE_DASHBOARD} 
          component={EmployeeDashboard}
          options={{ headerShown: false }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.ATTENDANCE_HISTORY} 
          component={AttendanceHistory}
          options={{ title: 'Attendance History' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.AUTHENTICATION_SCREEN} 
          component={AuthenticationScreen}
          options={{ title: 'Authentication' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.AUTH_METHOD_SELECTION} 
          component={AuthMethodSelection}
          options={{ title: 'Auth Settings' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.LEAVE_REQUEST} 
          component={LeaveRequestScreen}
          options={{ title: 'Leave Requests' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.CALENDAR} 
          component={CalendarScreen}
          options={{ title: 'Calendar' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.THEME_SETTINGS} 
          component={ThemeSettingsScreen}
          options={{ title: 'Theme Settings' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.NOTIFICATIONS} 
          component={NotificationsScreen}
          options={{ title: 'Notifications' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.TICKET_SCREEN} 
          component={TicketScreen}
          options={{ title: 'My Tickets' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.HELP_SUPPORT} 
          component={HelpSupportScreen}
          options={{ title: 'Help & Support' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.GEO_FENCING} 
          component={GeoFencingScreen}
          options={{ title: 'GeoFencing' }}
          initialParams={{ user }}
        />
      </Stack.Navigator>
    );
  }

  if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.MANAGER) {
    return (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen 
          name={ROUTES.ADMIN_DASHBOARD} 
          component={AdminDashboard}
          options={{ headerShown: false }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.CALENDAR} 
          component={CalendarScreen}
          options={{ title: 'Calendar' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.THEME_SETTINGS} 
          component={ThemeSettingsScreen}
          options={{ title: 'Theme Settings' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.NOTIFICATIONS} 
          component={NotificationsScreen}
          options={{ title: 'Notifications' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.HR_DASHBOARD} 
          component={HRDashboard}
          options={{ title: 'HR Dashboard' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.TICKET_MANAGEMENT} 
          component={TicketManagementScreen}
          options={{ title: 'Ticket Management' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.MANUAL_ATTENDANCE} 
          component={ManualAttendanceScreen}
          options={{ title: 'Manual Attendance' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.SIGNUP_APPROVAL} 
          component={SignupApprovalScreen}
          options={{ title: 'Signup Approvals' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.EMPLOYEE_MANAGEMENT} 
          component={EmployeeManagement}
          options={{ title: 'Employee Management' }}
          initialParams={{ user }}
        />
        {(user.role === ROLES.SUPER_ADMIN || isHRAdmin(user)) && (
          <>
            <Stack.Screen 
              name={ROUTES.CREATE_USER} 
              component={CreateUserScreen}
              options={{ title: 'Create User' }}
              initialParams={{ user }}
            />
          </>
        )}
        {user.role === ROLES.SUPER_ADMIN && (
          <>
            <Stack.Screen 
              name="ReportsScreen" 
              component={ReportsScreen}
              options={{ headerShown: false }}
              initialParams={{ user }}
            />
            <Stack.Screen 
              name={ROUTES.ATTENDANCE_SETTINGS} 
              component={AttendanceSettingsScreen}
              options={{ title: 'Attendance Settings' }}
              initialParams={{ user }}
            />
            <Stack.Screen 
              name={ROUTES.COMPANY_SETTINGS} 
              component={CompanySettingsScreen}
              options={{ title: 'Company Logo' }}
              initialParams={{ user }}
            />
          </>
        )}
        <Stack.Screen 
          name={ROUTES.HELP_SUPPORT} 
          component={HelpSupportScreen}
          options={{ title: 'Help & Support' }}
          initialParams={{ user }}
        />
        <Stack.Screen 
          name={ROUTES.GEO_FENCING} 
          component={GeoFencingScreen}
          options={{ title: 'GeoFencing' }}
          initialParams={{ user }}
        />
      </Stack.Navigator>
    );
  }

  // Fallback for unrecognized roles
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen 
        name={ROUTES.LOGIN} 
        component={LoginScreen}
        options={{ 
          title: 'hadir.ai',
          headerShown: false 
        }}
      />
    </Stack.Navigator>
  );
}

