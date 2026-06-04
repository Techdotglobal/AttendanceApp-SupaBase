import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/store/authStore';
import { LoginPage } from '../../features/auth/pages/LoginPage';
import { CompanyOnboardingPage } from '../../features/auth/pages/CompanyOnboardingPage';
import { AppShell } from '../../shared/components/AppShell';
import { DashboardPage } from '../../features/admin/pages/DashboardPage';
import { UsersPage } from '../../features/admin/pages/UsersPage';
import { DepartmentsPage } from '../../features/admin/pages/DepartmentsPage';
import { SitesPage } from '../../features/admin/pages/SitesPage';
import { AttendancePage } from '../../features/admin/pages/AttendancePage';
import { LeavesPage } from '../../features/admin/pages/LeavesPage';
import { AnalyticsPage } from '../../features/admin/pages/AnalyticsPage';
import { ReportsPage } from '../../features/admin/pages/ReportsPage';
import { SettingsPage } from '../../features/admin/pages/SettingsPage';
import { ManagerPermissionsPage } from '../../features/admin/pages/ManagerPermissionsPage';

function Protected({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="min-h-screen bg-slate-50 text-slate-700 p-8">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'employee') return <Navigate to="/unauthorized" replace />;
  return children;
}

function Unauthorized() {
  return <div className="min-h-screen bg-slate-50 text-red-500 p-8">You do not have portal access.</div>;
}

function SuperAdminOnly({ children }) {
  const { user } = useAuthStore();
  if (user?.role !== 'super_admin') return <Navigate to="/unauthorized" replace />;
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
        <Route path="users" element={<UsersPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="manager-permissions" element={<SuperAdminOnly><ManagerPermissionsPage /></SuperAdminOnly>} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="leaves" element={<LeavesPage />} />
      </Route>
    </Routes>
  );
}
