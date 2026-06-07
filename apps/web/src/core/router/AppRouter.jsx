import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/store/authStore';
import { canAccessFeature, isSuperAdmin } from '../../features/admin/permissions';
import { AccessDenied } from '../../shared/components/PermissionGate';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { CompanyOnboardingPage } from '../../features/auth/pages/CompanyOnboardingPage';
import { AppShell } from '../../shared/components/AppShell';
import { DashboardPage } from '../../features/admin/pages/DashboardPage';
import { UsersPage } from '../../features/admin/pages/UsersPage';
import { DepartmentsPage } from '../../features/admin/pages/DepartmentsPage';
import { SitesPage } from '../../features/admin/pages/SitesPage';
import { AttendancePage } from '../../features/admin/pages/AttendancePage';
import { LeavesPage } from '../../features/admin/pages/LeavesPage';
import { TicketsPage } from '../../features/admin/pages/TicketsPage';
import { CalendarPage } from '../../features/admin/pages/CalendarPage';
import { AnalyticsPage } from '../../features/admin/pages/AnalyticsPage';
import { ReportsPage } from '../../features/admin/pages/ReportsPage';
import { SettingsPage } from '../../features/admin/pages/SettingsPage';
import { ManagerPermissionsPage } from '../../features/admin/pages/ManagerPermissionsPage';
import { NotificationsPage } from '../../features/admin/pages/NotificationsPage';

function Protected({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="min-h-screen bg-slate-50 text-slate-700 p-8">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Unauthorized() {
  return <AccessDenied />;
}

function PermissionRoute({ feature, superAdminOnly = false, children }) {
  const { user } = useAuthStore();
  if (superAdminOnly && !isSuperAdmin(user)) return <AccessDenied />;
  if (!canAccessFeature(user, feature)) return <AccessDenied />;
  return children;
}

export function AppRouter() {
  const { bootstrap } = useAuthStore();
  useEffect(() => { bootstrap(); }, [bootstrap]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/onboard" element={<CompanyOnboardingPage />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/" element={<Protected><AppShell /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<PermissionRoute feature="users"><UsersPage /></PermissionRoute>} />
        <Route path="departments" element={<PermissionRoute feature="departments"><DepartmentsPage /></PermissionRoute>} />
        <Route path="analytics" element={<PermissionRoute feature="analytics"><AnalyticsPage /></PermissionRoute>} />
        <Route path="reports" element={<PermissionRoute feature="reports"><ReportsPage /></PermissionRoute>} />
        <Route path="settings" element={<PermissionRoute feature="settings"><SettingsPage /></PermissionRoute>} />
        <Route path="manager-permissions" element={<PermissionRoute feature="permissions" superAdminOnly><ManagerPermissionsPage /></PermissionRoute>} />
        <Route path="sites" element={<PermissionRoute feature="sites"><SitesPage /></PermissionRoute>} />
        <Route path="attendance" element={<PermissionRoute feature="attendance"><AttendancePage /></PermissionRoute>} />
        <Route path="leaves" element={<PermissionRoute feature="leaves"><LeavesPage /></PermissionRoute>} />
        <Route path="tickets" element={<PermissionRoute feature="tickets"><TicketsPage /></PermissionRoute>} />
        <Route path="calendar" element={<PermissionRoute feature="calendar"><CalendarPage /></PermissionRoute>} />
        <Route path="notifications" element={<PermissionRoute feature="notifications"><NotificationsPage /></PermissionRoute>} />
      </Route>
    </Routes>
  );
}
